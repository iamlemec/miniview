const { GObject, Gio, Meta, Clutter, St, Shell } = imports.gi;
const Lang = imports.lang;
const Signals = imports.signals;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Config = imports.misc.config;

const Gettext = imports.gettext.domain('miniview');
const _ = Gettext.gettext;

const MINIVIEW_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.miniview';

// get gnome shell version
let _display;
let [gsv_major, gsv_minor] = Config.PACKAGE_VERSION.split('.', 2)
if ((gsv_major >= 3) && (gsv_minor >= 30)) {
    _display = global.display;
} else {
    _display = global.screen;
}

let Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(miniview) {
        this._miniview = miniview;

        // get settings from schema
        this._settings = ExtensionUtils.getSettings();
        this._showme = this._settings.get_boolean('showme');
        this._settings.connect('changed', Lang.bind(this, this._settingsChanged));
        Main.wm.addKeybinding('toggle-miniview', this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, Lang.bind(this, this._onToggled));

        // create menu ui
        super._init(St.Align.START);
        let box = new St.BoxLayout();
        let icon = new St.Icon({ icon_name: 'emblem-photos-symbolic', style_class: 'system-status-icon emotes-icon'});

        box.add(icon);
        box.add(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.add_child(box);

        // on/off toggle
        this._tsToggle = new PopupMenu.PopupSwitchMenuItem(_("Enable Miniview"), false, { style_class: 'popup-subtitle-menu-item' });
        this._tsToggle.connect('toggled', Lang.bind(this, this._onToggled));
        this.menu.addMenuItem(this._tsToggle);

        // cycling through windows
        this._tsNext = new PopupMenu.PopupMenuItem(_("Next Window"));
        this._tsNext.connect('activate', Lang.bind(this, this._onNext));
        this.menu.addMenuItem(this._tsNext);

        this._tsPrev = new PopupMenu.PopupMenuItem(_("Previous Window"));
        this._tsPrev.connect('activate', Lang.bind(this, this._onPrev));
        this.menu.addMenuItem(this._tsPrev);

        // reset opacity (in case miniview got lost :) )
        this._tsResetMiniview = new PopupMenu.PopupMenuItem(_("Reset Miniview"));
        this._tsResetMiniview.connect('activate', Lang.bind(this, this._onResetMiniview));
        this.menu.addMenuItem(this._tsResetMiniview);

        // init ui
        this._reflectState();
    }

    _reflectState() {
        this._tsToggle.setToggleState(this._showme);
        if (this._showme) {
            this._miniview._showMiniview();
        } else {
            this._miniview._hideMiniview();
        }
    }

    _settingsChanged() {
        this._showme = this._settings.get_boolean('showme');
        this._reflectState();
    }

    _onToggled() {
        this._showme = !this._showme;
        this._settings.set_boolean('showme', this._showme);
        this._reflectState();
    }

    _onNext() {
        this._miniview._goWindowDown();
    }

    _onPrev() {
        this._miniview._goWindowUp();
    }

    _onResetMiniview() {
        this._miniview._clone.user_opacity = 255;
        this._miniview._clone.opacity = 255;
        this._miniview._clone.scale_x = 0.2;
        this._miniview._clone.scale_y = 0.2;
        this._miniview._clone.x = 100;
        this._miniview._clone.y = 100;
    }
});

let MiniviewClone = GObject.registerClass({
    Signals: {
        'scroll-up': {},
        'scroll-down': {}
    }
}, class MiniviewClone extends Clutter.Group {
    _init(miniview) {
        this._miniview = miniview;
        this._windowClone = new Clutter.Clone();

        // The MetaShapedTexture that we clone has a size that includes
        // the invisible border; this is inconvenient; rather than trying
        // to compensate all over the place we insert a ClutterGroup into
        // the hierarchy that is sized to only the visible portion.
        super._init({ reactive: true, x: 100, y: 100 });

        // We expect this to be used for all interaction rather than
        // this._windowClone; as the former is reactive and the latter
        // is not, this just works for most cases. However, for DND all
        // actors are picked, so DND operations would operate on the clone.
        // To avoid this, we hide it from pick.
        Shell.util_set_hidden_from_pick(this._windowClone, true);

        this.add_actor(this._windowClone);

        this.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
        this.connect('motion-event', Lang.bind(this, this._onMouseMove));
        this.connect('scroll-event', Lang.bind(this, this._onScroll));
        this.connect('enter-event', Lang.bind(this, this._onMouseEnter));
        this.connect('leave-event', Lang.bind(this, this._onMouseLeave));

        // interface state
        this.inMove = false;
        this.inResize = false;
        this.inResizeCtrl = false;

        // initial size
        this.scale_x = 0.2;
        this.scale_y = 0.2;
        this.visible = false;

        // opacity values
        this.user_opacity = 255;
    }

    _onButtonPress(actor, event) {
        // only allow one type of action at a time
        if (this.inMove || this.inResize || this.inResizeCtrl) {
            return true;
        }

        let [click_x, click_y] = event.get_coords();
        this.offset_x = click_x - this.x;
        this.offset_y = click_y - this.y;

        let button = event.get_button();
        let state = event.get_state();
        let ctrl = (state & Clutter.ModifierType.CONTROL_MASK) != 0;

        if ((button == 1) && (!ctrl)) {
            this.inMove = true;
        } else if ((button == 3) || ((button == 1) && ctrl)) {
            if (button == 3) {
                this.inResize = true;
            } else {
                this.inResizeCtrl = true;
            }

            this.offset_norm = Math.sqrt(Math.pow(this.offset_x,2)
                                        +Math.pow(this.offset_y,2));

            this.orig_scale_x = this.scale_x;
            this.orig_scale_y = this.scale_y;
        }

        return true;
    }

    _onButtonRelease(actor, event) {
        let button = event.get_button();

        if (button == 1) {
            if (this.inMove) {
                this.inMove = false;
            }

            if (this.inResizeCtrl) {
                this.inResizeCtrl = false;
            }

            if (event.get_click_count() == 2) {
                Main.activateWindow(this._metaWin);
            }
        } else if (button == 3) {
            if (this.inResize) {
                this.inResize = false;
            }
        }

        return true;
    }

    _onMouseMove(actor, event) {
        if (this.inMove || this.inResize || this.inResizeCtrl) {
            let [pos_x,pos_y] = event.get_coords();

            if (this.inMove) {
                this.x = pos_x - this.offset_x;
                this.y = pos_y - this.offset_y;
            }

            if (this.inResize || this.inResizeCtrl) {
                let new_offset_x = pos_x - this.x;
                let new_offset_y = pos_y - this.y;
                let new_offset_norm =  Math.sqrt(Math.pow(new_offset_x,2)
                                                +Math.pow(new_offset_y,2));

                this.scale_x = this.orig_scale_x*new_offset_norm/this.offset_norm;
                this.scale_y = this.orig_scale_y*new_offset_norm/this.offset_norm;
            }
        }

        return true;
    }

    _onScroll(actor, event) {
        // only allow one type of action at a time
        if (this.inMove || this.inResize || this.inResizeCtrl) {
            return true;
        }

        let direction = event.get_scroll_direction();
        let state = event.get_state();
        let ctrl = (state & Clutter.ModifierType.CONTROL_MASK) != 0;

        if (ctrl) {
            if (direction == Clutter.ScrollDirection.UP) {
                this.user_opacity += 10;
            } else if (direction == Clutter.ScrollDirection.DOWN) {
                this.user_opacity -= 10;
            }

            if (this.user_opacity > 255) {
                this.user_opacity = 255;
            } else if (this.user_opacity < 35) {
                this.user_opacity = 35;
            }

            this.opacity = this.user_opacity;
        } else {
            if (direction == Clutter.ScrollDirection.UP) {
                this.emit('scroll-up');
            } else if (direction == Clutter.ScrollDirection.DOWN) {
                this.emit('scroll-down');
            }
        }
    }

    _onMouseEnter(actor, event) {
        // decrease opacity a little bit
        this.opacity = Math.trunc(this.user_opacity * 0.8);
    }

    _onMouseLeave(actor, event) {
        if (this.inMove) {
            let [pos_x,pos_y] = event.get_coords();
            this.x = pos_x - this.offset_x;
            this.y = pos_y - this.offset_y;
        } else if (this.inResize) {
            this.inResize = false;
        } else if (this.inResizeCtrl) {
            this.inResizeCtrl = false;
        }
        else {
            // set opacity back to user value
            this.opacity = this.user_opacity;
        }
    }

    setSource(win) {
        this._metaWin = win.meta_window;
        this._windowClone.set_source(win);
    }
});

class Miniview {
    constructor(state) {
        this._state = state;
        this._stateTimeout = null;

        this._lastIdx = null;
        this._lastTimeout = null;

        let baseWindowList = global.get_window_actors();
        this._windowList = [];
        for (let i = 0; i < baseWindowList.length; i++) {
            let metaWin = baseWindowList[i].get_meta_window();
            if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
                this._windowList.push(metaWin);
            }
        }

        this._clone = new MiniviewClone(this);
        this._clone.connect('scroll-up', Lang.bind(this, this._goWindowUp));
        this._clone.connect('scroll-down', Lang.bind(this, this._goWindowDown));

        this._overviewShowingId = Main.overview.connect('showing',Lang.bind(this, this._overviewEnter));
        this._overviewHiddenId = Main.overview.connect('hidden', Lang.bind(this, this._overviewLeave));
        Main.layoutManager.addChrome(this._clone);

        this._winIdx = null;
        this._metaWin = null;
        this._shouldShow = true;

        if (this._windowList.length > 0) {
            this.setIndex(0);
            this._clone.visible = true;
        }

        this._windowEnteredMonitorId = _display.connect('window-entered-monitor', Lang.bind(this, this._windowEnteredMonitor));
        this._windowLeftMonitorId = _display.connect('window-left-monitor', Lang.bind(this, this._windowLeftMonitor));
    }

    destroy() {
        Main.overview.disconnect(this._overviewShowingId);
        Main.overview.disconnect(this._overviewHiddenId);

        _display.disconnect(this._windowEnteredMonitorId);
        _display.disconnect(this._windowLeftMonitorId);

        if (this._stateTimeout != null) {
            Mainloop.source_remove(this._stateTimeout);
        }

        if (this._clone) {
            this._clone.destroy();
        }
    }

    lookupIndex(metaWin) {
        for (let i = 0; i < this._windowList.length; i++) {
            if (this._windowList[i] == metaWin) {
                return i;
            }
        }
        return -1;
    }

    setIndex(idx) {
        // global.log(`miniview: setIndex: index=${idx}, current=${this._winIdx}, total=${this._windowList.length}`);

        if ((idx >= 0) && (idx < this._windowList.length)) {
            this._winIdx = idx;
            this._metaWin = this._windowList[this._winIdx];
            let win = this._metaWin.get_compositor_private();
            this._clone.setSource(win);

            // necessary to not get baffled by locking shenanigans
            if (this._stateTimeout != null) {
                Mainloop.source_remove(this._stateTimeout);
            }
            this._stateTimeout = Mainloop.timeout_add_seconds(1, Lang.bind(this,
                function() {
                    this._state.metaWin = this._metaWin;
                    this._stateTimeout = null;
                }
            ));
        }
    }

    _goWindowUp() {
        let idx = this._winIdx + 1;
        if (idx >= this._windowList.length) {
            idx = 0;
        }
        this.setIndex(idx);
    }

    _goWindowDown() {
        let idx = this._winIdx - 1;
        if (idx < 0) {
            idx = this._windowList.length - 1;
        }
        this.setIndex(idx);
    }

    _windowEnteredMonitor(metaScreen, monitorIndex, metaWin) {
        if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
            // let title = metaWin.get_title();
            // let index = this._windowList.length;
            // global.log(`miniview: _windowEnteredMonitor: index=${index}, current=${this._winIdx}, total=${this._windowList.length}, title=${title}`);
            this._insertWindow(metaWin);
        }
    }

    _insertWindow(metaWin) {
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

        // window already in the list?
        if (this.lookupIndex(metaWin) != -1) {
            return;
        }

        // add to list - possibly in original place in case of cross-monitor dragging
        if (this._lastIdx != null) {
            this._windowList.splice(this._lastIdx, 0, metaWin);
            if (this._lastActive) {
                this.setIndex(this._lastIdx);
            }
            Mainloop.source_remove(this._lastTimeout);
            this._lastIdx = null;
            this._lastActive = null;
            this._lastTimeout = null;
        } else {
            this._windowList.push(metaWin);
        }

        // got our first window
        if (this._shouldShow && (this._windowList.length == 1)) {
            this.setIndex(0);
            this._clone.visible = true;
        }
    }

    _windowLeftMonitor(metaScreen, monitorIndex, metaWin) {
        if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
            // let title = metaWin.get_title();
            // let index = this.lookupIndex(metaWin);
            // global.log(`miniview: _windowLeftMonitor   : index=${index}, current=${this._winIdx}, total=${this._windowList.length}, title=${title}`);
            this._removeWindow(metaWin);
        }
    }

    _removeWindow(metaWin) {
        let index = this.lookupIndex(metaWin);

        // not in list?
        if (index == -1) {
            return;
        }

        // store index briefly, in case of dragging between monitors
        // delay is usually about 1 millisecond in testing, so give it 100
        this._lastIdx = index;
        this._lastActive = (index == this._winIdx);
        if (this._lastTimeout != null) {
            Mainloop.source_remove(this._lastTimeout);
        }
        this._lastTimeout = Mainloop.timeout_add(100, Lang.bind(this,
            function() {
                this._lastIdx = null;
                this._lastActive = null;
                this._lastTimeout = null;
            }
        ));

        // remove from list
        this._windowList.splice(index, 1);

        // hide if no windows
        if (this._windowList.length == 0) {
            this._winIdx == null;
            this._clone.visible = false;
            return;
        }

        // check if is current window and update current window index if higher
        if (index == this._winIdx) {
            var idx = index % this._windowList.length;
            this.setIndex(idx); // update the window
        } else if (index < this._winIdx) {
            self._winIdx -= 1; // only the index, not the window itself
        }
    }

    // Tests if @win should be shown in the Overview
    _isOverviewWindow(metaWin) {
        let tracker = Shell.WindowTracker.get_default();
        return tracker.is_window_interesting(metaWin);
    }

    _showMiniview() {
        this._shouldShow = true;
        this._realizeMiniview();
    }

    _hideMiniview() {
        this._shouldShow = false;
        this._realizeMiniview();
    }

    _toggleMiniview() {
        if (this._shouldShow) {
            this._hideMiniview();
        } else {
            this._showMiniview();
        }
    }

    _overviewEnter() {
        this._clone.visible = false;
    }

    _overviewLeave() {
        this._realizeMiniview();
    }

    _realizeMiniview() {
        if (this._shouldShow) {
            if (this._windowList.length > 0) {
                let idx = this._winIdx;
                if ((idx == null) || (idx >= this._windowList.length) || (idx < 0)) {
                    idx = 0;
                }
                this.setIndex(idx);
                this._clone.visible = true;
            }
        } else {
            this._clone.visible = false;
        }
    }
}

// one time initializations
function init(meta) {
    ExtensionUtils.initTranslations('miniview');
}

// top level ui elements
let _indicator;
let _miniview;

// session state - ephemeral parameters
let state = {
    metaWin: null,
    pos_x: null,
    pos_y: null,
    size_x: null,
    size_y: null,
    opacity: null
}

function enable() {
    // global.log(`miniview: enable`)

    _miniview = new Miniview(state);
    _indicator = new Indicator(_miniview);
    Main.panel.addToStatusArea('miniview',_indicator);

    if (state.metaWin != null) {
        let idx = _miniview.lookupIndex(state.metaWin);
        if (idx == -1) { // maybe window was closed while locked?
            idx = 0;
            state.metaWin = null;
        }
        _miniview.setIndex(idx);
    }
    if (state.pos_x != null) {
        _miniview._clone.x = state.pos_x;
    }
    if (state.pos_y != null) {
        _miniview._clone.y = state.pos_y;
    }
    if (state.size_x != null) {
        _miniview._clone.scale_x = state.size_x;
    }
    if (state.size_y != null) {
        _miniview._clone.scale_y = state.size_y;
    }
    if (state.opacity != null) {
        _miniview._clone.user_opacity = state.opacity;
        _miniview._clone.opacity = state.opacity;
    }
}

function disable() {
    // global.log('miniview: disable')

    state.pos_x = _miniview._clone.x;
    state.pos_y = _miniview._clone.y;
    state.size_x = _miniview._clone.scale_x;
    state.size_y = _miniview._clone.scale_y;
    state.opacity = _miniview._clone.user_opacity;

    Main.wm.removeKeybinding('toggle-miniview');
    _indicator.destroy();
    _miniview.destroy();
}
