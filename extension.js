const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Lang = imports.lang;
const Signals = imports.signals;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const Gettext = imports.gettext.domain('miniview');
const _ = Gettext.gettext;

const MINIVIEW_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.miniview';

function WindowClone(miniview) {
    this._init(miniview);
}

const Indicator = new Lang.Class({
    Name: 'MiniviewMenu',
    Extends: PanelMenu.Button,

    _init: function(miniview) {
        this._miniview = miniview;

        // get settings from schema
        this._settings = Convenience.getSettings();
        this._showme = this._settings.get_boolean('showme');
        this._settings.connect('changed', Lang.bind(this, this._settingsChanged));
        Main.wm.addKeybinding('toggle-miniview', this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, Lang.bind(this, this._onToggled));

        this.parent(St.Align.START);
        this.label = new St.Label({text:'Mini'});
        this.label.set_style('padding-top: 4px;');
        this.actor.add_actor(this.label);

        // on/off toggle
        this._tsToggle = new PopupMenu.PopupSwitchMenuItem('Enable Miniview', false, { style_class: 'popup-subtitle-menu-item' });
        this._tsToggle.connect('toggled', Lang.bind(this, this._onToggled));
        this.menu.addMenuItem(this._tsToggle);

        // cycling through windows
        this._tsNext = new PopupMenu.PopupMenuItem('Next Window');
        this._tsNext.connect('activate', Lang.bind(this, this._onNext));
        this.menu.addMenuItem(this._tsNext);

        this._tsPrev = new PopupMenu.PopupMenuItem('Previous Window');
        this._tsPrev.connect('activate', Lang.bind(this, this._onPrev));
        this.menu.addMenuItem(this._tsPrev);

        // init ui
        this._reflectState();
    },

    _reflectState: function() {
        this._tsToggle.setToggleState(this._showme);
        if (this._showme) {
            this._miniview._showMiniview();
        } else {
            this._miniview._hideMiniview();
        }
    },

    _settingsChanged: function() {
        this._showme = this._settings.get_boolean('showme');
        this._reflectState();
    },

    _onToggled: function() {
        this._showme = !this._showme;
        this._settings.set_boolean('showme', this._showme);
        this._reflectState();
    },

    _onNext: function() {
        this._miniview._goWindowDown();
    },

    _onPrev: function() {
        this._miniview._goWindowUp();
    },
});

WindowClone.prototype = {
    _init : function(miniview) {
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
        this.actor.destroy();
    },

    _onButtonPress: function(actor, event) {
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
        let button = event.get_button();
        if (button == 1) {
            this.leftButtonDown = false;

            if (event.get_click_count() == 2) {
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
        let baseWindowList = global.get_window_actors();
        this._windowList = [];
        for (let i = 0; i < baseWindowList.length; i++) {
            let metaWin = baseWindowList[i].get_meta_window();
            if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
                this._windowList.push(metaWin);
            }
        }

        this._clone = new WindowClone(this);
        this._clone.connect('scroll-up', Lang.bind(this, this._goWindowUp));
        this._clone.connect('scroll-down', Lang.bind(this, this._goWindowDown));

        this._overviewShowingId = Main.overview.connect('showing',Lang.bind(this, this._overviewEnter));
        this._overviewHiddenId = Main.overview.connect('hidden', Lang.bind(this, this._overviewLeave));
        Main.layoutManager.addChrome(this._clone.actor);

        this._winIdx = 0;
        this._shouldShow = true;

        if (this._windowList.length) {
          let win = this._windowList[this._winIdx].get_compositor_private();
          this._clone.setSource(win);
          this._clone.actor.visible = true;
        }

        this._windowEnteredMonitorId = global.screen.connect('window-entered-monitor', Lang.bind(this, this._windowEnteredMonitor));
        this._windowLeftMonitorId = global.screen.connect('window-left-monitor', Lang.bind(this, this._windowLeftMonitor));
    },

    destroy: function() {
        Main.overview.disconnect(this._overviewShowingId);
        Main.overview.disconnect(this._overviewHiddenId);

        global.screen.disconnect(this._windowEnteredMonitorId);
        global.screen.disconnect(this._windowLeftMonitorId);

        if (this._clone) {
            this._clone.destroy();
        }
    },

    _goWindowUp: function() {
        this._winIdx += 1;
        if (this._winIdx >= this._windowList.length) {
            this._winIdx = 0;
        }

        let win = this._windowList[this._winIdx].get_compositor_private();
        this._clone.setSource(win);
    },

    _goWindowDown: function() {
        this._winIdx -= 1;
        if (this._winIdx < 0) {
            this._winIdx = this._windowList.length - 1;
        }

        let win = this._windowList[this._winIdx].get_compositor_private();
        this._clone.setSource(win);
    },

    _windowEnteredMonitor : function(metaScreen, monitorIndex, metaWin) {
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

        if (metaWin.get_window_type() != Meta.WindowType.NORMAL) {
            return;
        }

        if (this._lookupIndex(metaWin) != -1) {
            return;
        }

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

        let index = this._lookupIndex(metaWin);
        if (index == -1) {
            return;
        }

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

    _showMiniview: function() {
        this._shouldShow = true;
        this._realizeMiniview();
    },

    _hideMiniview: function() {
        this._shouldShow = false;
        this._realizeMiniview();
    },

    _toggleMiniview: function() {
        if (this._shouldShow) {
            this._hideMiniview();
        } else {
            this._showMiniview();
        }
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
}

function init(meta) {
    Convenience.initTranslations('miniview');
}

let _indicator;
let _miniview;

function enable() {
    _miniview = new Miniview();
    _indicator = new Indicator(_miniview);
    Main.panel.addToStatusArea('miniview',_indicator);
}

function disable() {
    _indicator.destroy();
    _miniview.destroy();
}
