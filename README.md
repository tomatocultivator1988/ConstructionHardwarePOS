# BuildPro POS System

A professional, full-featured **Point-of-Sale** system designed specifically for **construction supply and hardware businesses** in the Philippines. Built with a modern dark theme, real-time analytics, and BIR-compliant official receipts.

![Version](https://img.shields.io/badge/version-1.0.0-gold)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)

---

## Features

### Point-of-Sale
- **Invoice creation** with line-item entry, material selection, and auto stock deduction
- **Walk-in / Account Sale toggle** — handle cash sales or bill registered customers
- **Payment recording** with partial payment support and automatic status tracking
- **Stock validation** — prevents selling more than available inventory
- **Invoice history** — view, search, and reprint any past transaction

### Inventory Management
- **Material catalog** with unit tracking (pieces, kg, meters, gallons, etc.)
- **Cost price & retail price** tracking with automatic profit/margin calculation
- **Low stock alerts** — visual warnings when stock falls below reorder point
- **Stock valuation** — know your inventory value at cost and retail

### Customer Management
- **Customer directory** with phone, email, and address records
- **Purchase history** — see top customers and their spending
- **Walk-in support** — no need to create a customer for cash sales

### Analytics Dashboard
- **Today's Sales & Profit** — real-time snapshot
- **Revenue & Profit Trend** — 7-day chart with overlay
- **Top Selling Materials** — see what moves fastest
- **Margin by Material** — identify your most profitable items
- **Invoice Status Breakdown** — pending / partial / paid at a glance
- **Low Stock Chart** — visualize which items need reordering
- **Period Analytics Bar** — this month vs last month, this year, all time
- **Top Customers** — ranked by total paid

### BIR-Compliant Official Receipt
- **80mm thermal paper format** — prints directly to thermal receipt printers
- **Brand block** with business name, address, TIN, and BIR ATP number
- **VAT / Non-VAT breakdown** — shows VATable sales and VAT amount when applicable
- **Amount in Words** — proper "Pesos And Centavos Only" format
- **Status stamp overlay** — PAID / PARTIAL printed diagonally across paid receipts
- **Payment summary** — shows amounts paid, outstanding balance, and payment methods
- **Signature lines** — received by and customer signature areas
- **BIR disclaimer footer** — legally required text for official receipts

### Security
- **API token authentication** — protect your data with `X-API-Token` header
- **Rate limiting** — 100 requests per minute per IP
- **Security headers** via Helmet
- **CORS restriction** — only your frontend origin can access the API
- **Request size limiting** — 1MB max payload
- **Input validation** on all endpoints

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla TypeScript SPA (no framework) |
| **Backend** | Express 5 + TypeScript |
| **Database** | SQLite (better-sqlite3) |
| **Charts** | Chart.js 4 |
| **Build** | Vite 8 |
| **Security** | Helmet, CORS, rate limiting |

---

## Distribution as EXE

Ship a single `.exe` to your client — no Node.js, no setup required.

### Build the EXE

```bash
cd backend
npm run build:exe
```

This produces **`backend/BuildProPOS.exe`** (~50 MB) containing the server, frontend, and database engine in one file.

### Client Setup

1. Place `BuildProPOS.exe` anywhere on the computer
2. (Optional) Create a `.env` file next to it to set `API_TOKEN` or `PORT`
3. Double-click the `.exe` — the database is automatically created in a `data/` folder next to the `.exe`
4. Open `http://localhost:3001` in the browser

The server starts, creates the SQLite database on first run, and serves the POS interface on port 3001.

### Database Location

By default the database is stored in `./data/construction_pos.db` (relative to where you run the `.exe`). Override with the `DB_PATH` environment variable:

```bash
set DB_PATH=C:\MyStore\data\pos.db
BuildProPOS.exe
```

### Configuration

Set any of these via `.env` file or environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `API_TOKEN` | *(empty)* | Set to enable API authentication |
| `DB_PATH` | `./data/construction_pos.db` | Database file location |

---

## Development Setup

### Prerequisites
- Node.js 18+
- npm

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/buildpro-pos.git
cd buildpro-pos

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Configure environment
cd ../backend
cp .env.example .env
# Edit .env to set your API_TOKEN and other settings

# Start development servers
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

### Production Build

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd ../frontend
npm run build

# Start production server
cd ../backend
NODE_ENV=production npm start
```

The production server serves the frontend automatically.

---

## Configuration

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `API_TOKEN` | *(empty)* | Set to a secure random string to enable auth |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend URL for CORS |

---

## Screenshots

> *(Screenshots coming soon)*

---

## Project Structure

```
buildpro-pos/
├── backend/
│   ├── src/
│   │   ├── db/          # Database setup & migrations
│   │   ├── routes/      # API route handlers
│   │   └── index.ts     # Server entry point
│   ├── data/            # SQLite database (gitignored)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── lib/         # API client, helpers, types, router
│   │   ├── views/       # Dashboard, Invoices, Materials, Customers, Settings, Receipt
│   │   ├── main.ts      # Entry point
│   │   └── style.css    # Dark theme styles
│   ├── dist/            # Production build output
│   └── package.json
└── README.md
```

---

## License

MIT
