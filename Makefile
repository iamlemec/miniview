RELEASE_ZIP = miniview.zip
MO_FILES = $(shell find locale -name \*.mo)
RELEASE_FILES = metadata.json extension.js prefs.js $(MO_FILES) schemas README.md LICENSE

all: release

release: $(RELEASE_ZIP)

clean:
	rm $(RELEASE_ZIP)

$(RELEASE_ZIP): $(RELEASE_FILES)
	zip -r $(RELEASE_ZIP) $(RELEASE_FILES)
