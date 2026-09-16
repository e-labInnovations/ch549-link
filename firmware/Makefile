# Build every debugger firmware.
DEBUGGERS := swio

.PHONY: all clean $(DEBUGGERS)
all: $(DEBUGGERS)

$(DEBUGGERS):
	@echo "==> $@"
	@$(MAKE) -C $@

clean:
	@for d in $(DEBUGGERS); do $(MAKE) -C $$d clean; done
