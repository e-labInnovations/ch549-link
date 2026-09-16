# Top-level convenience targets.
#
#   make firmware     build all debugger firmwares (needs sdcc)
#   make docker       build them in a container instead (needs docker)
#   make dist         assemble the web flasher payload into dist/
#   make clean

IMAGE ?= ch549-link-build

.PHONY: firmware docker docker-image dist clean

firmware:
	@$(MAKE) -C firmware

docker-image:
	@docker build -t $(IMAGE) .

docker: docker-image
	@docker run --rm -v "$(CURDIR)":/app $(IMAGE)

dist: firmware
	@python3 tools/make_manifest.py --out dist --strict

clean:
	@$(MAKE) -C firmware clean
	@rm -rf dist
