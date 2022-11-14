#!/usr/bin/gjs

imports.gi.versions.Gdk = "4.0";
imports.gi.versions.Gtk = "4.0";
const { GObject, Gio, Gdk, Gtk, Adw } = imports.gi;
const GioSSS = Gio.SettingsSchemaSource;

function getSettings() {
    let schema = 'org.gnome.shell.extensions.miniview';
    let schemaSource = GioSSS.new_from_directory('schemas', GioSSS.get_default(), false);
    let schemaObj = schemaSource.lookup(schema, true);
    return new Gio.Settings({ settings_schema: schemaObj });
}

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
    constructor(value) {
        super();
        this.label = new Gtk.ShortcutLabel({accelerator: value});
        this.add_child(this.label);
        this.choosing = false;
    }

    _resetState() {
        this.state = {...state0};
    }

    _modString() {
        return Object.entries(this.state)
                     .filter(([k, v]) => v)
                     .map(([k, v]) => `<${modNames[k]}>`)
                     .join('');
    }

    _keyPress(keyval) {
        if (modMap.has(keyval)) {
            let mod = modMap.get(keyval);
            this.state[mod] = true;
        } else {
            let mod = this._modString();
            let key = Gdk.keyval_name(keyval);
            let acc = mod + key;
            this.label.set_accelerator(acc);
            this._disableChoosing(true);
        }
    }

    _keyRelease(keyval) {
        if (modMap.has(keyval)) {
            let mod = modMap.get(keyval);
            this.state[mod] = false;
        }
    }

    _enableChoosing() {
        this.choosing = true;
        this.label.add_css_class('choosing');
        this._resetState();
    }

    _disableChoosing(save) {
        this.choosing = false;
        this.label.remove_css_class('choosing');
    }

    _connect(target) {
        let keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (self, keyval, keycode, state) => {
            if (this.choosing) {
                if (keyval == Gdk.KEY_Escape) {
                    this._disableChoosing(false);
                } else {
                    this._keyPress(keyval);
                }
            }
        });
        keys.connect('key-released', (self, keyval, keycode, state) => {
            if (this.choosing) {
                this._keyRelease(keyval);
            }
        });
        target.add_controller(keys);

        let clicks = new Gtk.GestureClick();
        clicks.connect('released', (self, n, x, y) => {
            if (!this.choosing) {
                this._enableChoosing();
            }
        });
        this.add_controller(clicks);
    }
});

let MiniviewPrefsWidget = GObject.registerClass(
class MiniviewPrefsWidget extends Adw.PreferencesPage {
    constructor() {
        super({
            name: 'miniview_preferences',
            title: 'Miniview Preferences',
        });

        // settings
        this._settings = getSettings();

        // panel indicator
        let switch_pan = this._makeSwitch(
            'showind',
            'Show indicator button in panel',
            'Exposes a menu in the panel with navigation and toggle options',
        );

        // hide on focus
        let switch_hof = this._makeSwitch(
            'hide-on-focus',
            'Hide Miniview when target window is focused',
            'Avoids showing a preview of the window you\'re currently looking at',
        );

        // show-hide key chooser
        let [keychoose_disp, kdisp] = this._makeKeychoose(
            'toggle-miniview',
            'Keyboard shortcut for toggling Miniview display',
            'Click to select new keyboard shortcut'
        );

        // group together
        let group = new Adw.PreferencesGroup();
        group.add(switch_pan);
        group.add(switch_hof);
        group.add(keychoose_disp);
        this.add(group);

        // connect keychooser
        kdisp._connect(this);
        kdisp.label.set_name('toggle-key');
    }

    _makeSwitch(key, title, subtitle) {
        let value = this._settings.get_boolean(key);
        let row = new Adw.ActionRow({title, subtitle});
        let toggle = new Gtk.Switch({active: value, valign: Gtk.Align.CENTER});
    
        row.add_suffix(toggle);
        row.activatable_widget = toggle;
        row.toggle = toggle;

        return row;
    }

    _makeKeychoose(key, title, subtitle) {
        let [value, ..._] = this._settings.get_strv(key);
        let keychoose = new KeyChooserWidget(value);
        let row = new Adw.ActionRow({title, subtitle});
        row.add_suffix(keychoose);
        return [row, keychoose];
    }
});

const css = `
window {
    padding: 50px;
}

row box {
    padding: 10px;
}

shortcut {
    padding: 5px;
    border: 1px solid rgba(0,0,0,0);
}

shortcut.choosing {
    border: 1px solid red;
}
`.trim();

// init
Gtk.init();

// test
let page = new MiniviewPrefsWidget();

// window
let win = new Gtk.Window({
    title: 'Miniview Preferences',
    default_height: 500,
    default_width: 700,
});
win.connect('destroy', () => { Gtk.main_quit(); });
win.set_child(page);

// add style
let prov = new Gtk.CssProvider();
prov.load_from_data(css);
Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(), prov, Gtk.StyleProvider.PRIORITY_USER
);

// application
let app = new Gtk.Application({
    application_id: 'org.gtk.Example'
});
app.connect('activate', () => {
    app.add_window(win);
    win.present();
});

// run
app.run([]);
