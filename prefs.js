import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const modMap = new Map([
    [Gdk.KEY_Control_L, 'control'],
    [Gdk.KEY_Control_R, 'control'],
    [Gdk.KEY_Alt_L, 'alt'],
    [Gdk.KEY_Alt_R, 'alt'],
    [Gdk.KEY_Shift_L, 'shift'],
    [Gdk.KEY_Shift_R, 'shift'],
]);

const modNames = {
    control: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
};

const state0 = Object.fromEntries(
    Object.entries(modNames).map(([k, v]) => [k, false])
);

let KeyChooserWidget = GObject.registerClass(
class KeyChooserWidget extends Gtk.Stack {
    constructor(window, row, settings, key) {
        super();
        this._settings = settings;
        this._key = key;

        let value = this._fetchValue();
        this.label = new Gtk.ShortcutLabel({accelerator: value});
        this.add_child(this.label);

        let keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (self, keyval, keycode, state) => this._keyPressed(keyval));
        keys.connect('key-released', (self, keyval, keycode, state) => this._keyReleased(keyval));
        window.add_controller(keys);

        let clicks = new Gtk.GestureClick();
        clicks.connect('released', (self, n, x, y) => this._clickReleased());
        row.add_controller(clicks);

        this._choosing = false;
    }

    _resetState() {
        this.state = {...state0};
    }

    _fetchValue() {
        let [value, ..._] = this._settings.get_strv(this._key);
        return value;
    }

    _updateValue() {
        let value = this._fetchValue();
        this._disableChoosing();
        this.label.set_accelerator(value);
    }

    _modString() {
        return Object.entries(this.state)
                     .filter(([k, v]) => v)
                     .map(([k, v]) => `<${modNames[k]}>`)
                     .join('');
    }

    _enableChoosing() {
        this._choosing = true;
        this.label.add_css_class('choosing');
        this._resetState();
    }

    _disableChoosing(accel) {
        this._choosing = false;
        this.label.remove_css_class('choosing');
        if (accel != null) {
            this._settings.set_strv(this._key, [accel]);
        }
    }

    _chooseKeyPressed(keyval) {
        if (modMap.has(keyval)) {
            let mod = modMap.get(keyval);
            this.state[mod] = true;
        } else {
            let mod = this._modString();
            let key = Gdk.keyval_name(keyval);
            let acc = mod + key;
            this.label.set_accelerator(acc);
            this._disableChoosing(acc);
        }
    }

    _chooseKeyReleased(keyval) {
        if (modMap.has(keyval)) {
            let mod = modMap.get(keyval);
            this.state[mod] = false;
        }
    }

    _keyPressed(keyval) {
        if (this._choosing) {
            if (keyval == Gdk.KEY_Escape) {
                this._disableChoosing();
            } else {
                this._chooseKeyPressed(keyval);
            }
            return true;
        }
    }

    _keyReleased(keyval) {
        if (this._choosing) {
            this._chooseKeyReleased(keyval);
            return true;
        }
    }

    _clickReleased() {
        if (this._choosing) {
            this._disableChoosing();
        } else {
            this._enableChoosing();
        }
        return true;
    }
});

const css = `
shortcut {
    padding: 5px;
    margin-top: 5px;
    margin-bottom: 5px;
    border: 1px solid rgba(0,0,0,0);
}

shortcut.choosing {
    border: 1px solid @destructive_color;
    border-radius: 5px;
}
`.trim();

let MiniviewPrefsWidget = GObject.registerClass(
class MiniviewPrefsWidget extends Adw.PreferencesPage {
    constructor(settings) {
        super({
            name: 'miniview_preferences',
            title: 'Miniview Preferences',
        });

        // settings
        this._settings = settings;

        // panel indicator
        let [row_ind, switch_ind] = this._makeSwitch(
            'showind',
            'Show indicator button in panel',
            'Exposes a menu in the panel with navigation and toggle options',
        );

        // hide on focus
        let [row_hof, switch_hof] = this._makeSwitch(
            'hide-on-focus',
            'Hide Miniview when target window is focused',
            'Avoids showing a preview of the window you\'re currently looking at',
        );

        // show-hide key chooser
        let [row_key, choose_key] = this._makeKeychoose(
            'toggle-miniview',
            'Keybinding for toggling Miniview display',
            'Click to select new keyboard shortcut'
        );

        // group together
        let group = new Adw.PreferencesGroup();
        group.add(row_ind);
        group.add(row_hof);
        group.add(row_key);
        this.add(group);

        // add style
        let prov = new Gtk.CssProvider();
        prov.load_from_data(css, -1);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), prov, Gtk.StyleProvider.PRIORITY_USER
        );

        // update when settings externally set
        this._settings.connect('changed', (setobj, action) => {
            if (action == 'toggle-miniview') {
                choose_key._updateValue();
            } else if (action == 'showind') {
                let ind = this._settings.get_boolean('showind');
                switch_ind.set_active(ind);
            } else if (action == 'hide-of-focus') {
                let hof = this._settings.get_boolean('hide-on-focus');
                switch_hof.set_active(hof);
            }
        });
    }

    _makeSwitch(key, title, subtitle) {
        let value = this._settings.get_boolean(key);
        let row = new Adw.ActionRow({title, subtitle});
        let toggle = new Gtk.Switch({active: value, valign: Gtk.Align.CENTER});
    
        row.add_suffix(toggle);
        row.activatable_widget = toggle;
        row.toggle = toggle;
    
        this._settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    
        return [row, toggle];
    }

    _makeKeychoose(key, title, subtitle) {
        let row = new Adw.ActionRow({title, subtitle, activatable: false});
        let keychoose = new KeyChooserWidget(this, row, this._settings, key);
        row.add_suffix(keychoose);
        return [row, keychoose];
    }
    
});

export default class MiniviewPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = this.getSettings();
        let widget = new MiniviewPrefsWidget(settings);
        window.add(widget);
    }
}
