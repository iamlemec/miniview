RELEASE_ZIP = miniview.zip
RELEASE_FILES = metadata.json extension.js prefs.js locale schemas README.md LICENSE

all: release

release: $(RELEASE_ZIP)

clean:
	rm $(RELEASE_ZIP)

$(RELEASE_ZIP): $(RELEASE_FILES)
	zip -r $(RELEASE_ZIP) $(RELEASE_FILES)
