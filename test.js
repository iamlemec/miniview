#!/usr/bin/gjs

imports.gi.versions.Gtk = "3.0";
const { GnomeDesktop, GObject, Gtk, Gio } = imports.gi;
const GioSSS = Gio.SettingsSchemaSource;

function append_hotkey(model, settings, name, pretty_name) {
    let accel = settings.get_strv(name)[0];
    let [key, mods] = Gtk.accelerator_parse(accel);
    let row = model.insert(10);
    model.set(row, [0, 1, 2, 3], [name, pretty_name, mods, key ]);
}

function get_settings() {
    let schema = 'org.gnome.shell.extensions.miniview';
    let schemaSource = GioSSS.new_from_directory('schemas', GioSSS.get_default(), false);
    let schemaObj = schemaSource.lookup(schema, true);
    return new Gio.Settings({ settings_schema: schemaObj });
}

// init
Gtk.init(null);

// settings
let settings = get_settings();

// frame
let frame = new Gtk.Frame({
    vexpand: false,
    hexpand: true,
    label: 'Configure Keyboard Shortcuts'
});

// tree model
let model = new Gtk.ListStore();
model.set_column_types([
    GObject.TYPE_STRING,
    GObject.TYPE_STRING,
    GObject.TYPE_INT,
    GObject.TYPE_INT
]);

let treeview = new Gtk.TreeView({
    vexpand: false,
    hexpand: true,
    margin: 10,
    model: model
});

// keybinding name
let cell1 = new Gtk.CellRendererText();
let col1 = new Gtk.TreeViewColumn({
    title: 'Action',
    expand: true
});

col1.pack_start(cell1, true);
col1.add_attribute(cell1, 'text', 1);
treeview.append_column(col1);

// keybinding information
let cell2 = new Gtk.CellRendererAccel({
    editable: true,
    accel_mode: Gtk.CellRendererAccelMode.GTK
});
cell2.connect('accel-edited', (rend, colname, key, mods) => {
    let value = Gtk.accelerator_name(key, mods);
    let [success, iter] = model.get_iter_from_string(colname);
    let name = model.get_value(iter, 0);
    model.set(iter, [ 2, 3 ], [ mods, key ]);
    settings.set_strv(name, [value]);
    print('Accel edited for ' + name + ': ' + value);
});
cell2.connect('accel-cleared', (rend, colname) => {
    let value = Gtk.accelerator_name(0, 0);
    let [success, iter] = model.get_iter_from_string(colname);
    let name = model.get_value(iter, 0);
    model.set(iter, [ 2, 3 ], [ 0, 0 ]);
    settings.set_strv(name, [value]);
    print('Accel cleared for ' + name + ': ' + value);
});

let col2 = new Gtk.TreeViewColumn({
    title: 'Accel'
});

col2.pack_end(cell2, false);
col2.add_attribute(cell2, 'accel-mods', 2);
col2.add_attribute(cell2, 'accel-key', 3);
treeview.append_column(col2);

// set up keybindings
append_hotkey(model, settings, 'toggle-miniview', 'Toggle Miniview');

// outer box
let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, margin: 50 });
frame.add(treeview);
box.add(frame);

// window
const win = new Gtk.Window({ defaultHeight: 400, defaultWidth: 500 });
win.connect('destroy', () => { Gtk.main_quit(); });
win.add(box);
win.show_all();

Gtk.main();
