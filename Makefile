.PHONY: install frontend build selfcheck

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

selfcheck:
	cd frontend && npm run selfcheck

build:
	cd frontend && npm run build
