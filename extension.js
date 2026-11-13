import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Shell from 'gi://Shell';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

let _display = global.display;



let MiniviewIndicator = GObject.registerClass(
    class MiniviewIndicator extends PanelMenu.Button {
        _init(miniview, toggleState) {
            this._miniview = miniview;

            // create menu ui
            super._init(0.5, 'Miniview');
            let box = new St.BoxLayout();
            let icon = new St.Icon({ icon_name: 'emblem-photos-symbolic', style_class: 'system-status-icon emotes-icon' });

            box.add_child(icon);
            box.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));
            this.add_child(box);

            // on/off toggle
            this._tsToggle = new PopupMenu.PopupSwitchMenuItem(_('Enable Miniview'), false, { style_class: 'popup-subtitle-menu-item' });
            this.setToggleState(toggleState);
            this.menu.addMenuItem(this._tsToggle);

            // cycling through windows
            this._tsNext = new PopupMenu.PopupMenuItem(_('Next Window'));
            this._tsNext.connect('activate', this._onNext.bind(this));
            this.menu.addMenuItem(this._tsNext);

            this._tsPrev = new PopupMenu.PopupMenuItem(_('Previous Window'));
            this._tsPrev.connect('activate', this._onPrev.bind(this));
            this.menu.addMenuItem(this._tsPrev);

            // reset ephemeral parameters (in case miniview got lost :) )
            this._tsResetMiniview = new PopupMenu.PopupMenuItem(_('Reset Miniview'));
            this._tsResetMiniview.connect('activate', this._onResetMiniview.bind(this));
            this.menu.addMenuItem(this._tsResetMiniview);

            // extension preferences
            this._tsPreferences = new PopupMenu.PopupMenuItem(_('Preferences'));
            this._tsPreferences.connect('activate', () => this._miniview.openPreferences());
            this.menu.addMenuItem(this._tsPreferences);

            // for double click detection
            this._prev_click_time = null;
        }

        _onToggled() {
            this._miniview._toggleMiniview();
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
            this._miniview._clone.inMove = false;
            this._miniview._clone.inResize = false;
            this._miniview._clone.inResizeCtrl = false;
        }

        setToggleState(state) {
            if (this._toggleHandlerId) {
                this._tsToggle.disconnect(this._toggleHandlerId);
            }

            this._tsToggle.setToggleState(state);
            this._toggleHandlerId = this._tsToggle.connect('toggled', this._onToggled.bind(this));
        }
    });

let MiniviewClone = GObject.registerClass({
    Signals: {
        'scroll-up': {},
        'scroll-down': {},
    },
}, class MiniviewClone extends Clutter.Actor {
    _init(miniview) {

        this._miniview = miniview;
        this._windowClone = new Clutter.Clone();

        super._init({ reactive: true, x: 100, y: 100, });
        // Hide the window clone from pointer picking.
        Shell.util_set_hidden_from_pick(this._windowClone, true);
        this.add_child(this._windowClone);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('scroll-event', this._onScroll.bind(this));
        this.connect('enter-event', this._onMouseEnter.bind(this));
        this.connect('leave-event', this._onMouseLeave.bind(this));

        // Mouse interaction state.
        this.inMove = false;
        this.inResize = false;
        this.inResizeCtrl = false;
        this._pressedOnClone = false;

        this._prev_click_time = null;

        // Initial size and position.
        this.scale_x = 0.2;
        this.scale_y = 0.2;
        this.visible = false;

        // Opacity.
        this.user_opacity = 255;



        // // IMPORTANT:
        // // Capture events at the stage level so mouse releases
        // // are detected even when the pointer leaves this actor.
        // this._stageEventId = global.stage.connect(
        //     'captured-event',
        //     this._onStageEvent.bind(this)
        // );
        this.connect('button-release-event', this._onButtonRelease.bind(this));
        this.connect('motion-event', this._onMouseMove.bind(this));

        // Pointer grab handle
        this._dragGrab = null;
        this._activeButton = null;
    }

    // _onStageEvent(stage, event) {
    //     const type = event.type();

    //     if (type === Clutter.EventType.MOTION) {
    //         if (this.inMove || this.inResize || this.inResizeCtrl) {
    //             this._onMouseMove(this, event);
    //             return Clutter.EVENT_STOP;
    //         }
    //     }

    //     if (type === Clutter.EventType.BUTTON_RELEASE) {
    //         if (this._pressedOnClone ||
    //             this.inMove ||
    //             this.inResize ||
    //             this.inResizeCtrl) {
    //             this._onButtonRelease(this, event);
    //             return Clutter.EVENT_STOP;
    //         }
    //     }

    //     return Clutter.EVENT_PROPAGATE;
    // }

    _onButtonPress(actor, event) {
        if (this.inMove || this.inResize || this.inResizeCtrl)
            return Clutter.EVENT_STOP;

        const [clickX, clickY] = event.get_coords();

        this.offset_x = clickX - this.x;
        this.offset_y = clickY - this.y;

        const button = event.get_button();
        const state = event.get_state();

        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (shift)
            return Clutter.EVENT_PROPAGATE;

        if (button === 1 && !ctrl) {
            this.inMove = true;
        } else if (button === 3 || (button === 1 && ctrl)) {
            this.inResize = button === 3;
            this.inResizeCtrl = button === 1 && ctrl;

            this.offset_norm = Math.max(
                Math.hypot(this.offset_x, this.offset_y),
                1
            );

            this.orig_scale_x = this.scale_x;
            this.orig_scale_y = this.scale_y;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }

        this._activeButton = button;

        // Grab the pointer so release and motion events continue
        // reaching this actor outside its boundaries.
        this._dragGrab = global.stage.grab(this);

        return Clutter.EVENT_STOP;
    }
    _onButtonRelease(actor, event) {
        const button = event.get_button();

        // Ignore unrelated button releases.
        if (this._activeButton !== null &&
            button !== this._activeButton) {
            return Clutter.EVENT_STOP;
        }

        const state = event.get_state();
        const shift =
            (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        const time = event.get_time();

        // GNOME 51-compatible double-click settings.
        const dbtime = this.get_context()
            .get_settings().double_click_time;

        const dbclick =
            this._prev_click_time !== null &&
            (time - this._prev_click_time) < dbtime;

        this._prev_click_time = time;

        // Remember the action before resetting it.
        const wasMoving = this.inMove;

        // Reset interaction state.
        this.inMove = false;
        this.inResize = false;
        this.inResizeCtrl = false;
        this._activeButton = null;

        // Release the pointer grab.
        if (this._dragGrab) {
            this._dragGrab.dismiss();
            this._dragGrab = null;
        }

        // Alternative window cycling.
        if (shift) {
            if (button === 1)
                this.emit('scroll-up');
            else if (button === 3)
                this.emit('scroll-down');

            return Clutter.EVENT_STOP;
        }

        // Double-click activates the selected window.
        if (button === 1 && dbclick && this._metaWin) {
            Main.activateWindow(this._metaWin);
        }

        this.opacity = this.user_opacity;

        return Clutter.EVENT_STOP;
    }

    _onMouseMove(actor, event) {
        if (!this.inMove && !this.inResize && !this.inResizeCtrl) {
            return Clutter.EVENT_PROPAGATE;
        }

        const [posX, posY] = event.get_coords();

        if (this.inMove) {
            this.x = posX - this.offset_x;
            this.y = posY - this.offset_y;
        }

        if (this.inResize || this.inResizeCtrl) {
            const newOffsetX = posX - this.x;
            const newOffsetY = posY - this.y;

            const newOffsetNorm = Math.hypot(
                newOffsetX,
                newOffsetY
            );

            const scaleFactor =
                newOffsetNorm / this.offset_norm;

            this.scale_x = Math.max(
                0.05,
                this.orig_scale_x * scaleFactor
            );

            this.scale_y = Math.max(
                0.05,
                this.orig_scale_y * scaleFactor
            );
        }

        return Clutter.EVENT_STOP;
    }

    _onScroll(actor, event) {
        if (this.inMove || this.inResize || this.inResizeCtrl)
            return Clutter.EVENT_STOP;

        const direction = event.get_scroll_direction();
        const state = event.get_state();

        const ctrl =
            (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (ctrl) {
            if (direction === Clutter.ScrollDirection.UP)
                this.user_opacity += 10;
            else if (direction === Clutter.ScrollDirection.DOWN)
                this.user_opacity -= 10;

            this.user_opacity = Math.max(
                35,
                Math.min(255, this.user_opacity)
            );

            this.opacity = this.user_opacity;
        } else {
            if (direction === Clutter.ScrollDirection.UP)
                this.emit('scroll-up');
            else if (direction === Clutter.ScrollDirection.DOWN)
                this.emit('scroll-down');
        }

        return Clutter.EVENT_STOP;
    }

    _onMouseEnter() {
        this.opacity = Math.trunc(this.user_opacity * 0.8);
        return Clutter.EVENT_PROPAGATE;
    }

    _onMouseLeave() {
        // Do not cancel dragging or resizing here.
        // The stage-level event handler handles these operations.

        if (!this.inMove &&
            !this.inResize &&
            !this.inResizeCtrl) {
            this.opacity = this.user_opacity;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    setSource(win) {
        if (!win)
            return;

        this._metaWin = win.meta_window;
        this._windowClone.set_source(win);
    }

    destroy() {
        if (this._dragGrab) {
            this._dragGrab.dismiss();
            this._dragGrab = null;
        }

        this.inMove = false;
        this.inResize = false;
        this.inResizeCtrl = false;
        this._activeButton = null;

        super.destroy();
    }
});

export default class Miniview extends Extension {
    constructor(metadata) {
        super(metadata);

        // session state - ephemeral parameters
        this.state = {
            metaWin: null,
            pos_x: null,
            pos_y: null,
            size_x: null,
            size_y: null,
            opacity: null
        };
    }

    enable() {
        // global.log(`miniview: enable`)

        // get current settings
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', this._settingsChanged.bind(this));
        this._fetchSettings();

        // panel menu
        this._indicator = new MiniviewIndicator(this);
        Main.panel.addToStatusArea('miniview', this._indicator);

        // the actual window clone actor
        this._clone = new MiniviewClone(this);
        this._clone.connect('scroll-up', this._goWindowUp.bind(this));
        this._clone.connect('scroll-down', this._goWindowDown.bind(this));

        // add to top level chrome
        Main.layoutManager.addChrome(this._clone);

        // track windows as they move across monitors or are created/destroyed
        this._windowEnteredMonitorId = _display.connect('window-entered-monitor', this._windowEnteredMonitor.bind(this));
        this._windowLeftMonitorId = _display.connect('window-left-monitor', this._windowLeftMonitor.bind(this));
        this._windowFocusNotifyId = _display.connect('notify::focus-window', this._windowFocusMonitor.bind(this));

        // for tracking across locking/suspending
        this._state = this.state;
        this._stateTimeout = null;

        // for screen hops (which look like leaving one monitor then quickly entering another)
        this._lastIdx = null;
        this._lastTimeout = null;

        // we use this when inserting windows
        this._insertTimeout = null;

        // start out with null window info
        this._winIdx = null;
        this._metaWin = null;

        // assemble window list
        this._populateWindows();

        // this is a hack so we eventually purge the desktop window in ubuntu
        this._populateTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, this._populateWindows.bind(this));

        // assign global toggle
        Main.wm.addKeybinding('toggle-miniview', this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, this._toggleMiniview.bind(this));

        // implement settings
        this._reflectState();

        // restore state
        if (this.state.metaWin != null) {
            let idx = this.lookupIndex(this.state.metaWin);
            if (idx == -1) { // maybe window was closed while locked?
                idx = 0;
                this.state.metaWin = null;
            }
            this.setIndex(idx);
        }
        if (this.state.pos_x != null) {
            this._clone.x = this.state.pos_x;
        }
        if (this.state.pos_y != null) {
            this._clone.y = this.state.pos_y;
        }
        if (this.state.size_x != null) {
            this._clone.scale_x = this.state.size_x;
        }
        if (this.state.size_y != null) {
            this._clone.scale_y = this.state.size_y;
        }
        if (this.state.opacity != null) {
            this._clone.user_opacity = this.state.opacity;
            this._clone.opacity = this.state.opacity;
        }
    }

    disable() {
        // global.log('miniview: disable')

        // save state
        this.state.pos_x = this._clone.x;
        this.state.pos_y = this._clone.y;
        this.state.size_x = this._clone.scale_x;
        this.state.size_y = this._clone.scale_y;
        this.state.opacity = this._clone.user_opacity;

        _display.disconnect(this._windowEnteredMonitorId);
        _display.disconnect(this._windowLeftMonitorId);
        _display.disconnect(this._windowFocusNotifyId);

        this._settings.disconnect(this._settingsChangedId);
        this._settings = null;
        Main.wm.removeKeybinding('toggle-miniview');

        if (this._stateTimeout != null) {
            GLib.Source.remove(this._stateTimeout);
            this._stateTimeout = null;
        }
        if (this._lastTimeout != null) {
            GLib.Source.remove(this._lastTimeout);
            this._lastTimeout = null;
        }
        if (this._insertTimeout != null) {
            GLib.Source.remove(this._insertTimeout);
            this._insertTimeout = null;
        }
        if (this._populateTimeout != null) {
            GLib.Source.remove(this._populateTimeout);
            this._populateTimeout = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
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
        if (!this._windowList ||
            idx < 0 ||
            idx >= this._windowList.length) {
            return;
        }

        const metaWin = this._windowList[idx];
        const win = metaWin.get_compositor_private();

        if (!win)
            return;

        this._winIdx = idx;
        this._metaWin = metaWin;

        this._clone.setSource(win);

        if (this._stateTimeout !== null) {
            GLib.Source.remove(this._stateTimeout);
            this._stateTimeout = null;
        }

        this._stateTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._state.metaWin = this._metaWin;
            this._stateTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _populateWindows() {
        this._windowList = [];
        let baseWindowList = global.get_window_actors();
        for (let i = 0; i < baseWindowList.length; i++) {
            let metaWin = baseWindowList[i].get_meta_window();
            if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
                this._windowList.push(metaWin);
            }
        }

        // not our first rodeo
        if (this._metaWin != null) {
            let idx = this.lookupIndex(this._metaWin);
            if (this._winIdx != idx) {
                this.setIndex(idx);
            }
            this._realizeMiniview();
        }
    }

    _goWindowUp() {
        if (!this._windowList || this._windowList.length === 0)
            return;

        let idx = (this._winIdx ?? -1) + 1;

        if (idx >= this._windowList.length)
            idx = 0;

        this.setIndex(idx);
    }

    _goWindowDown() {
        if (!this._windowList || this._windowList.length === 0)
            return;

        let idx = (this._winIdx ?? 0) - 1;

        if (idx < 0)
            idx = this._windowList.length - 1;

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
            this._insertTimeout = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._clone && metaWin.get_compositor_private()) {
                    this._insertWindow(metaWin);
                }
                return false;
            });

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
            GLib.Source.remove(this._lastTimeout);
            this._lastIdx = null;
            this._lastActive = null;
            this._lastTimeout = null;
        } else {
            this._windowList.push(metaWin);
        }

        // got our first window
        if (this._showme && (this._windowList.length == 1)) {
            this._realizeMiniview();
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

    _windowFocusMonitor(display) {
        this._realizeMiniview();
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
            GLib.Source.remove(this._lastTimeout);
        }
        this._lastTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._lastIdx = null;
            this._lastActive = null;
            this._lastTimeout = null;
        });

        // remove from list
        this._windowList.splice(index, 1);

        // hide if no windows
        if (this._windowList.length == 0) {
            this._winIdx = null;
            this._clone.visible = false;
            return;
        }

        // check if is current window and update current window index if higher
        if (index == this._winIdx) {
            var idx = index % this._windowList.length;
            this.setIndex(idx); // update the window
        } else if (index < this._winIdx) {
            this._winIdx -= 1; // only the index, not the window itself
        }
    }

    _realizeMiniview() {
        if (this._showme) {
            if (this._windowList.length > 0) {
                let idx = this._winIdx;
                if ((idx == null) || (idx >= this._windowList.length) || (idx < 0)) {
                    idx = 0;
                }
                this.setIndex(idx);

                if (this._hidefoc) {
                    let activeWindow = _display.get_focus_window();
                    if (activeWindow == this._metaWin) {
                        this._clone.visible = false;
                    } else {
                        this._clone.visible = true;
                    }
                } else {
                    this._clone.visible = true;
                }
            } else {
                this._clone.visible = false;
            }
        } else {
            this._clone.visible = false;
        }
    }

    _reflectState() {
        this._indicator.setToggleState(this._showme);
        this._indicator.visible = this._showind;
        this._realizeMiniview();
    }

    _toggleMiniview() {
        this._showme = !this._showme;
        this._settings.set_boolean('showme', this._showme);
        this._reflectState();
    }

    _settingsChanged() {
        this._fetchSettings();
        this._reflectState();
    }

    _fetchSettings() {
        this._showme = this._settings.get_boolean('showme');
        this._showind = this._settings.get_boolean('showind');
        this._hidefoc = this._settings.get_boolean('hide-on-focus');
    }
}
