const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Lang = imports.lang;
const Signals = imports.signals;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;

const MINIVIEW_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.miniview';

function WindowClone(miniview) {
    this._init(miniview);
}

WindowClone.prototype = {
    _init : function(miniview) {
        global.log('WindowClone._init');

        this._miniview = miniview;
        this._windowClone = new Clutter.Clone();

        // The MetaShapedTexture that we clone has a size that includes
        // the invisible border; this is inconvenient; rather than trying
        // to compensate all over the place we insert a ClutterGroup into
        // the hierarchy that is sized to only the visible portion.
        this.actor = new Clutter.Group({ reactive: true,
                                         x: 100,
                                         y: 100 });

        // We expect this.actor to be used for all interaction rather than
        // this._windowClone; as the former is reactive and the latter
        // is not, this just works for most cases. However, for DND all
        // actors are picked, so DND operations would operate on the clone.
        // To avoid this, we hide it from pick.
        Shell.util_set_hidden_from_pick(this._windowClone, true);

        this.actor.add_actor(this._windowClone);

        this.actor._delegate = this;

        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.actor.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
        this.actor.connect('motion-event', Lang.bind(this, this._onMouseMove));
        this.actor.connect('scroll-event', Lang.bind(this, this._onScroll));
        this.actor.connect('enter-event', Lang.bind(this, this._onMouseEnter));
        this.actor.connect('leave-event', Lang.bind(this, this._onMouseLeave));

        this.leftButtonDown = false;
        this.rightButtonDown = false;

        // initial size
        this.actor.scale_x = 0.2;
        this.actor.scale_y = 0.2;
        this.actor.visible = false;
    },

    destroy: function () {
        global.log('WindowClone.destroy()');
        this.actor.destroy();
    },

    _onButtonPress: function(actor, event) {
        global.log('miniview._onButtonPress(' + event.get_button() + ')');

        [click_x, click_y] = event.get_coords();
        this.offset_x = click_x - this.actor.x;
        this.offset_y = click_y - this.actor.y;

        let button = event.get_button();
        if (button == 1) {
            this.leftButtonDown = true;
        } else if (button == 3) {
            this.rightButtonDown = true;

            this.offset_norm = Math.sqrt(Math.pow(this.offset_x,2)
                                        +Math.pow(this.offset_y,2));

            this.orig_scale_x = this.actor.scale_x;
            this.orig_scale_y = this.actor.scale_y;
        }

        return true;
    },

    _onButtonRelease: function(actor, event) {
        global.log('miniview._onButtonRelease(' + event.get_button() + ')');

        let button = event.get_button();
        if (button == 1) {
            this.leftButtonDown = false;

            if (event.get_click_count() == 2) {
                global.log('double clicked');
                Main.activateWindow(this._metaWin);
            }
        } else if (button == 3) {
            this.rightButtonDown = false;
        }

        return true;
    },

    _onMouseMove: function(actor, event) {
        if (this.leftButtonDown || this.rightButtonDown) {
            let [pos_x,pos_y] = event.get_coords();

            if (this.leftButtonDown) {
                this.actor.x = pos_x - this.offset_x;
                this.actor.y = pos_y - this.offset_y;
            }

            if (this.rightButtonDown) {
                let new_offset_x = pos_x - this.actor.x;
                let new_offset_y = pos_y - this.actor.y;
                let new_offset_norm =  Math.sqrt(Math.pow(new_offset_x,2)
                                                +Math.pow(new_offset_y,2));

                this.actor.scale_x = this.orig_scale_x*new_offset_norm/this.offset_norm;
                this.actor.scale_y = this.orig_scale_y*new_offset_norm/this.offset_norm;
            }
        }

        return true;
    },

    _onScroll: function(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction == Clutter.ScrollDirection.UP) {
            this.emit('scroll-up');
        } else if (direction == Clutter.ScrollDirection.DOWN) {
            this.emit('scroll-down');
        }
    },

    _onMouseEnter: function(actor, event) {
        this.actor.opacity = 200;
    },

    _onMouseLeave: function(actor, event) {
        if (this.leftButtonDown) {
            let [pos_x,pos_y] = event.get_coords();
            this.actor.x = pos_x - this.offset_x;
            this.actor.y = pos_y - this.offset_y;
        }
        else {
            this.actor.opacity = 255;
        }
    },

    setSource: function(win) {
        this._metaWin = win.meta_window;
        this._windowClone.set_source(win.get_texture());
    }
};
Signals.addSignalMethods(WindowClone.prototype);

function Miniview() {
  this._init();
}

Miniview.prototype = {
    _init: function() {
        global.log('Miniview._init');

        var display = global.screen.get_display();

        //display.add_keybinding('toggle-miniview', new Gio.Settings({ schema: MINIVIEW_SETTINGS_SCHEMA }), Meta.KeyBindingFlags.NONE, Lang.bind(this, this._onStageKeyPress));

        let baseWindowList = global.get_window_actors();
        this._windowList = [];
        for (let i = 0; i < baseWindowList.length; i++) {
            let metaWin = baseWindowList[i].get_meta_window();
            if (this._isOverviewWindow(metaWin)) {
                this._windowList.push(metaWin);
            }
        }

        global.log('temp 2');

        global.log('_windowList.length = ' + this._windowList.length);

        this._clone = new WindowClone(this);
        this._clone.connect('scroll-up', Lang.bind(this, this._goWindowUp));
        this._clone.connect('scroll-down', Lang.bind(this, this._goWindowDown));

        Main.overview.connect('showing',Lang.bind(this, this._overviewEnter));
        Main.overview.connect('hidden', Lang.bind(this, this._overviewLeave));
        Main.layoutManager.addChrome(this._clone.actor);

        this._winIdx = 0;
        this._shouldShow = true;

        if (this._windowList.length) {
          let win = this._windowList[this._winIdx].get_compositor_private();
          this._clone.setSource(win);
          this._clone.actor.visible = true;
        }

        global.screen.connect('window-entered-monitor', Lang.bind(this, this._windowEnteredMonitor));
        global.screen.connect('window-left-monitor', Lang.bind(this, this._windowLeftMonitor));
    },

    destroy: function() {
        global.log('Miniview.destroy');

        if (this._clone) {
            this._clone.destroy();
        }
    },

    _goWindowUp: function() {
        global.log('Miniview._goWindowUp');

        this._winIdx += 1;
        if (this._winIdx >= this._windowList.length) {
            this._winIdx = 0;
        }

        global.log('winIdx = ' + this._winIdx);

        let win = this._windowList[this._winIdx].get_compositor_private();
        this._clone.setSource(win);
    },

    _goWindowDown: function() {
        global.log('Miniview._goWindowDown');

        this._winIdx -= 1;
        if (this._winIdx < 0) {
            this._winIdx = this._windowList.length - 1;
        }

        global.log('winIdx = ' + this._winIdx);

        let win = this._windowList[this._winIdx].get_compositor_private();
        this._clone.setSource(win);
    },

    _windowEnteredMonitor : function(metaScreen, monitorIndex, metaWin) {
        global.log('Miniview._windowEnteredMonitor');
        this._insertWindow(metaWin);
    },

    _insertWindow : function(metaWin) {
        let win = metaWin.get_compositor_private();

        if (!win) {
            // Newly-created windows are added to a workspace before
            // the compositor finds out about them...
            Mainloop.idle_add(Lang.bind(this,
                function () {
                    if (this._clone && metaWin.get_compositor_private()) {
                        this._insertWindow(metaWin);
                    }
                    return false;
                }
            ));

            return;
        }

        global.log('Miniview._insertWindow(' + win + ')');

        //if (!this.isOverviewWindow(metaWin)) {
        //    return;
        //}

        global.log('isOverviewWindow = true');

        if (this._lookupIndex(metaWin) != -1) {
            return;
        }

        global.log('insert at ' + this._windowList.length);

        this._windowList.push(metaWin);

        // got our first window
        if (this._shouldShow && (this._windowList.length == 1)) {
            this._winIdx == 0;
            this._clone.setSource(win);
            this._clone.actor.visible = true;
        }
    },

    _windowLeftMonitor : function(metaScreen, monitorIndex, metaWin) {
        let win = metaWin.get_compositor_private();

        global.log('Miniview._windowLeftMonitor(' + win + ')');

        let index = this._lookupIndex(metaWin);
        if (index == -1) {
            return;
        }

        global.log('remove at = ' + index);

        this._windowList.splice(index, 1);

        // check if is current window and update current window index if higher
        if (index == this._winIdx) {
            if (this._winIdx == this._windowList.length) {
                this._winIdx = 0;
            }

            if (this._windowList.length) {
                let new_win = this._windowList[this._winIdx].get_compositor_private();
                this._clone.setSource(new_win);
            } else {
                this._clone.actor.visible = false;
            }
        } else if (this._winIdx > index) {
            this._winIdx -= 1;
        }
    },

    // Tests if @win should be shown in the Overview
    _isOverviewWindow : function (metaWin) {
        let tracker = Shell.WindowTracker.get_default();
        return tracker.is_window_interesting(metaWin);
    },

    _lookupIndex: function (metaWindow) {
        for (let i = 0; i < this._windowList.length; i++) {
            if (this._windowList[i] == metaWindow) {
                return i;
            }
        }
        return -1;
    },

    _toggleMiniview: function() {
        this._shouldShow = !this._shouldShow;
        this._realizeMiniview();
    },

    _overviewEnter: function() {
        this._clone.actor.visible = false;
    },

    _overviewLeave: function() {
        this._realizeMiniview();
    },

    _realizeMiniview: function() {
        if (this._shouldShow) {
            if (this._windowList.length) {
                if (this._winIdx >= this._windowList.length) {
                    this._winIdx = 0;
                }

                let win = this._windowList[this._winIdx].get_compositor_private();
                this._clone.setSource(win);
                this._clone.actor.visible = true;
            }
        } else {
            this._clone.actor.visible = false;
        }
    },

    _onStageKeyPress: function(display, screen, window, event, binding) {
        global.log('Miniview._onStageKeyPress');

        this._toggleMiniview();
    }
}

function init(meta) {
    // empty
}

let _miniview;

function enable() {
    _miniview = new Miniview();
}

function disable() {
    _miniview.destroy();
}

