# selfai-vis

SelfAI visualization and interactive optimization demo, with a Next.js frontend and FastAPI backend.

## Development Docs

- English: `docs/01-development-guide.md`
- 中文: `docs/01-development-guide.zh.md`
- Page Design (EN): `docs/02-page-design.md`
- 页面设计 (ZH): `docs/02-page-design.zh.md`
- Demo Page Design (EN): `docs/03-demo-page-design.md`
- Demo 页面设计 (ZH): `docs/03-demo-page-design.zh.md`

## Quick Start

### Backend

```bash
cd server
pip install -r requirements-service.txt
uvicorn service_backend.app:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd web
npm install
npm run dev
```
