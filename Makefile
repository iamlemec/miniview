RELEASE_FILES = metadata.json extension.js prefs.js locale schemas README.md LICENSE
RELEASE_ZIP = miniview.zip

all: release

release: $(RELEASE_ZIP)

clean:
	rm $(RELEASE_ZIP)

miniview.zip: $(RELEASE_FILES)
	zip -r $(RELEASE_ZIP) $(RELEASE_FILES)
