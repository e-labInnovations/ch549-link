# Top-level convenience targets.
#
#   make firmware     build all debugger firmwares (needs sdcc)
#   make docker       build them in a container instead (needs docker)
#   make manifest     package whatever is already built into dist/
#   make dist         firmware + manifest
#   make clean

IMAGE ?= ch549-link-build

.PHONY: firmware docker docker-image manifest dist clean

firmware:
	@$(MAKE) -C firmware

docker-image:
	@docker build -t $(IMAGE) .

docker: docker-image
	@docker run --rm -v "$(CURDIR)":/app $(IMAGE)

# Deliberately has no prerequisite on `firmware`: after `make docker` the
# images exist but sdcc does not, and depending on firmware would make this
# target unusable in exactly that case (CI, and any machine without sdcc).
manifest:
	@python3 tools/make_manifest.py --out dist --strict

dist: firmware manifest

clean:
	@$(MAKE) -C firmware clean
	@rm -rf dist
