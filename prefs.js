const { GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const Gettext = imports.gettext.domain('miniview');
const _ = Gettext.gettext;

let MiniviewPrefsWidget = GObject.registerClass(
class MiniviewPrefsWidget extends Gtk.Box {
    _init() {
        super._init({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 50,
            margin_bottom: 50,
            margin_start: 50,
            margin_end: 50
        });

        // settings
        this._settings = ExtensionUtils.getSettings();

        // frame
        this._frame = new Gtk.Frame({
            vexpand: false,
            hexpand: true,
            label: _('Configure Keyboard Shortcuts'),
        });

        // tree model
        this._model = new Gtk.ListStore();
        this._model.set_column_types([
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
            GObject.TYPE_INT,
            GObject.TYPE_INT
        ]);

        this._treeview = new Gtk.TreeView({
            vexpand: false,
            hexpand: true,
            model: this._model,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10
        });

        // keybinding name
        let cell1 = new Gtk.CellRendererText();
        let col1 = new Gtk.TreeViewColumn({
            title: _('Action'),
            expand: true
        });

        col1.pack_start(cell1, true);
        col1.add_attribute(cell1, 'text', 1);
        this._treeview.append_column(col1);

        // keybinding information
        let cell2 = new Gtk.CellRendererAccel({
            editable: true,
            accel_mode: Gtk.CellRendererAccelMode.GTK
        });
        cell2.connect('accel-edited', (rend, colname, key, mods) => {
            this._setKeybinding(colname, key, mods);
        });
        cell2.connect('accel-cleared', (rend, colname) => {
            this._setKeybinding(colname, 0, 0);
        });

        let col2 = new Gtk.TreeViewColumn({
            title: _('Accel')
        });

        col2.pack_end(cell2, false);
        col2.add_attribute(cell2, 'accel-mods', 2);
        col2.add_attribute(cell2, 'accel-key', 3);
        this._treeview.append_column(col2);

        // inidicator toggle
        this._indicator = new Gtk.CheckButton({ label: 'Show indicator button in panel' });
        let ind = this._settings.get_boolean('showind');
        this._indicator.set_active(ind);
        this._indicator.connect('toggled', (tog) => {
            let ind = this._settings.get_boolean('showind');
            this._settings.set_boolean('showind', !ind);
        });

        // layout
        this._frame.set_child(this._treeview);
        this.append(this._frame);
        this.append(this._indicator);

        // set up keybindings
        this._toggleRow = this._appendHotkey('toggle-miniview', _('Toggle Miniview'));

        // update when settings externally set
        this._settings.connect('changed', (setobj, action) => {
            if (action == 'toggle-miniview') {
                let accel = this._settings.get_string(action);
                let [ok, key, mods] = Gtk.accelerator_parse(accel);
                let row = this._toggleRow;
                this._model.set(row, [ 2, 3 ], [ mods, key ]);
            } else if (action == 'showind') {
                let ind = this._settings.get_boolean('showind');
                this._indicator.set_active(ind);
            }
        });
    }

    _appendHotkey(name, pretty_name) {
        let accel = this._settings.get_strv(name)[0];
        let [ok, key, mods] = Gtk.accelerator_parse(accel);
        let row = this._model.append();
        this._model.set(row, [0, 1, 2, 3], [name, pretty_name, mods, key ]);
        return row;
    }

    _setKeybinding(colname, key, mods) {
        let value = Gtk.accelerator_name(key, mods);
        let [success, iter] = this._model.get_iter_from_string(colname);
        let name = this._model.get_value(iter, 0);
        this._model.set(iter, [ 2, 3 ], [ mods, key ]);
        this._settings.set_strv(name, [value]);
    }

});

function init() {
}

function buildPrefsWidget() {
    let widget = new MiniviewPrefsWidget();
    widget.show();
    return widget;
}
