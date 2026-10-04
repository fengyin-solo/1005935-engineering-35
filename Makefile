.PHONY: install frontend build selfcheck

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

# 消防器材规则自检：压力越限与检查超期各报各的；build 的 prebuild 钩子会先跑它。
selfcheck:
	cd frontend && npm run selfcheck

build:
	cd frontend && npm run build
