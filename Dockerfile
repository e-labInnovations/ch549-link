# Build environment for ch549-link firmware.
#
# Unlike a vendor SDK, everything here comes from apt - SDCC is packaged, so
# this builds and runs natively on both amd64 and Apple Silicon. No --platform
# pin is needed.
#
# Pinned to 25.10 because that ships SDCC 4.5.0, which is what the firmware was
# developed and tested against. Older SDCC releases reject some of the syntax in
# the vendored ch55xduino USB sources.
FROM ubuntu:25.10

RUN apt-get update && \
	apt-get install -y --no-install-recommends \
		sdcc \
		binutils \
		make \
		python3 \
		xxd && \
	rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build only. Flashing needs USB access, which Docker Desktop does not pass
# through on macOS - flash from the host with isp55e0, or use the web flasher.
CMD ["make", "-C", "firmware"]
