export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface Material {
  id: string;
  name: string;
  unit: string;
  stock: number;
  cost_price: number;
  price_per_unit: number;
  reorder_point: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  material_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  payment_date: string;
  notes: string | null;
}

export interface Invoice {
  id: string;
  customer_id: string | null;
  invoice_number: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  status: 'pending' | 'partial' | 'paid';
  issued_date: string;
  due_date: string | null;
  paid_date: string | null;
  created_at: string;
  customer_name: string;
  items: InvoiceItem[];
  payments: Payment[];
}

export interface Analytics {
  topMaterials: any[];
  profitTrend: any[];
  stockValue: { total_cost: number; total_retail: number; material_count: number };
  materialMargins: any[];
  todayProfit: number;
  weekRevenue: number;
  monthRevenue: { revenue: number; profit: number };
  lastMonthRevenue: { revenue: number; profit: number };
  yearRevenue: { revenue: number; profit: number };
  overallRevenue: { revenue: number; profit: number };
  monthlyTrend: any[];
  topCustomers: any[];
}

export interface PaySummary {
  daily: { date: string; total: number }[];
  todayTotal: number;
}
