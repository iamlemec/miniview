/* exported init, buildPrefsWidget */
const { GnomeDesktop, GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const MINIVIEW_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.miniview';

function append_hotkey(model, settings, name, pretty_name) {
    let accel = settings.get_strv(name)[0];
    let [key, mods] = Gtk.accelerator_parse(accel);
    let row = model.insert(10);
    model.set(row, [0, 1, 2, 3], [name, pretty_name, mods, key ]);
}

const Prefs = class MiniviewPrefsWidget {
    constructor() {
        global.log('Starting miniview preferences');

        let settings = Convenience.getSettings();

        let model = new Gtk.ListStore();
        model.set_column_types([
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
            GObject.TYPE_INT,
            GObject.TYPE_INT
        ]);

        let treeview = new Gtk.TreeView({
            'expand': true,
            'model': model
        });

        // keybinding name
        let cell1 = new Gtk.CellRendererText();
        let col1 = new Gtk.TreeViewColumn({
            'title': 'Keybinding',
            'expand': true
        });

        col1.pack_start(cell1, true);
        col1.add_attribute(cell1, 'text', 1);
        treeview.append_column(col1);

        // keybinding information
        let cell2 = new Gtk.CellRendererAccel({
            'editable': true,
            'accel-mode': Gtk.CellRendererAccelMode.GTK
        });
        cell2.connect('accel-edited', (rend, colname, key, mods) => {
            let value = Gtk.accelerator_name(key, mods);
            let [success, iter] = model.get_iter_from_string(colname);
            let name = model.get_value(iter, 0);
            model.set(iter, [ 2, 3 ], [ mods, key ]);
            global.log('Changing value for ' + name + ': ' + value);
            settings.set_strv(name, [value]);
        });

        let col2 = new Gtk.TreeViewColumn({
            'title': 'Accel'
        });

        col2.pack_end(cell2, false);
        col2.add_attribute(cell2, 'accel-mods', 2);
        col2.add_attribute(cell2, 'accel-key', 3);
        treeview.append_column(col2);

        // set up keybindings
        append_hotkey(model, settings, 'toggle-miniview', 'Toggle Miniview');

        // update when settings externally set
        settings.connect('changed', (setobj, key) => {
            if (key == 'toggle-miniview') {
                let accel = settings.get_string('toggle-miniview');
                let [key, mods] = Gtk.accelerator_parse(accel);
                model.set(iter, [ 2, 3 ], [ mods, key ]);
                global.log('Keybinding ' + key + ' externally changed to ' + accel);
            }
        });

        this.win = new Gtk.ScrolledWindow({
            'vexpand': true
        });
        this.win.add(treeview);
        this.win.show_all();

        // let schemaKey = this._settings.settings_schema.get_key(key);
        // this._settings.bind(key, adj, 'value', Gio.SettingsBindFlags.DEFAULT);
    }
}

function init() {
}

function buildPrefsWidget() {
    let prefs = new Prefs();
    return prefs.win;
}
