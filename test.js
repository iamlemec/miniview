#!/usr/bin/gjs

imports.gi.versions.Gtk = "4.0";
const { GObject, Gtk, Gio } = imports.gi;
const GioSSS = Gio.SettingsSchemaSource;

function append_hotkey(model, settings, name, pretty_name) {
    let accel = settings.get_strv(name)[0];
    let [ok, key, mods] = Gtk.accelerator_parse(accel);
    let row = model.append();
    model.set(row, [0, 1, 2, 3], [name, pretty_name, mods, key ]);
}

function set_keybinding(model, settings, colname, key, mods) {
    let value = Gtk.accelerator_name(key, mods);
    let [success, iter] = model.get_iter_from_string(colname);
    let name = model.get_value(iter, 0);
    model.set(iter, [ 2, 3 ], [ mods, key ]);
    settings.set_strv(name, [value]);
}

function get_settings() {
    let schema = 'org.gnome.shell.extensions.miniview';
    let schemaSource = GioSSS.new_from_directory('schemas', GioSSS.get_default(), false);
    let schemaObj = schemaSource.lookup(schema, true);
    return new Gio.Settings({ settings_schema: schemaObj });
}

// init
Gtk.init();

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
    GObject.TYPE_STRING, // name
    GObject.TYPE_STRING, // pretty_name
    GObject.TYPE_INT, // mods
    GObject.TYPE_INT // key
]);

let treeview = new Gtk.TreeView({
    vexpand: false,
    hexpand: true,
    model: model,
    margin_top: 10,
    margin_bottom: 10,
    margin_start: 10,
    margin_end: 10
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
cell2.connect('accel-edited', (rend, colname, key, mods, code) => {
    set_keybinding(model, settings, colname, key, mods);
    print('Accel edited for ' + colname + ': ' + mods);
});
cell2.connect('accel-cleared', (rend, colname) => {
    set_keybinding(model, settings, colname, 0, 0);
    print('Accel cleared for ' + colname);
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
let box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10
});
frame.set_child(treeview);
box.append(frame);

// window
let win = new Gtk.ApplicationWindow({
    defaultHeight: 400,
    defaultWidth: 500
});
win.connect('destroy', () => { Gtk.main_quit(); });
win.set_child(box);

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
