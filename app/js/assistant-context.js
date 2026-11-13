// Monta só um resumo agregado para o assistente. Nunca envia o estado inteiro,
// nomes de pessoas/contas ou descrições individuais de lançamentos.

import { addMonths } from './util.js';
import { expensesByCategory, leftover, monthItems, summarize } from './model.js';

function monthSummary(state, ym) {
  const items = monthItems(state, ym);
  const totals = summarize(items);
  const forecast = leftover(state, ym, null, items);
  const categories = expensesByCategory(state, items).slice(0, 30).map(({ category, total }) => ({
    name: String(category.name || 'Sem categoria').slice(0, 60),
    total,
    limit: Number(category.budget) || 0,
    extraMargin: Number(category.estimate) || 0,
  }));
  const dueByDate = new Map();
  for (const item of items) {
    if (item.type !== 'expense' || item.paid || item.onCard || item.transfer || !item.date) continue;
    const row = dueByDate.get(item.date) || { date: item.date, count: 0, total: 0 };
    row.count++;
    row.total = Math.round((row.total + item.amount) * 100) / 100;
    dueByDate.set(item.date, row);
  }

  return {
    month: ym,
    income: totals.income,
    plannedExpenses: totals.expense,
    paidExpenses: totals.paid,
    pendingExpenses: totals.pending,
    monthlyNet: totals.balance,
    projectedRemainder: forecast.left,
    projectedIncome: forecast.income,
    projectedHouseExpenses: forecast.house,
    projectedPersonalExpenses: forecast.personal,
    categories,
    unpaidBillsByDate: [...dueByDate.values()].slice(0, 20),
  };
}

export function buildAssistantContext(state, ym, today) {
  return {
    currency: 'BRL',
    today,
    selectedMonth: ym,
    selectedMonthSummary: monthSummary(state, ym),
    previousMonthSummary: monthSummary(state, addMonths(ym, -1)),
    limitations: [
      'The summary has no individual transaction descriptions, account names, or person names.',
      'The projected remainder is the Monetizeo calculation and is not the same as current bank balance.',
    ],
  };
}
