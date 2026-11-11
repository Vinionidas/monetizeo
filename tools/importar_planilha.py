"""Lê a planilha "Finanças Pessoais" (.xlsx) e gera um JSON no formato antigo,
que tools/migrar.mjs converte para o formato do Monetizeo.

Uso (precisa de `pip install openpyxl`):

    python tools/importar_planilha.py "C:/caminho/Financas.xlsx" saida.json

Na prática, use tools/migrar.mjs, que chama este script e grava data/state.json.
"""

from __future__ import annotations

import datetime as dt
import json
import sys

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("Falta a biblioteca openpyxl. Instale com: pip install openpyxl")

ACCOUNT_TYPES = {
    "cartão de crédito": "card",
    "conta corrente": "bank",
    "poupança": "bank",
    "carteira": "cash",
    "financiamento": "credit",
}
GROUPS = {"necessidade": "need", "desejo": "want", "investimento": "invest"}


def iso(value):
    if isinstance(value, (dt.datetime, dt.date)):
        return value.strftime("%Y-%m-%d")
    return None


def table(ws, first_header, stop_at_blank=True):
    """Linhas de uma tabela, como dicionários, a partir da linha de cabeçalho
    que contém `first_header`. As colunas vão até a primeira célula vazia."""
    rows = list(ws.iter_rows(values_only=True))
    for r, row in enumerate(rows):
        if first_header not in row:
            continue
        start = row.index(first_header)
        headers = []
        for cell in row[start:]:
            if cell is None:
                break
            headers.append(str(cell).strip())
        out = []
        for data in rows[r + 1 :]:
            cells = data[start : start + len(headers)]
            if cells[0] is None:
                if stop_at_blank:
                    break
                continue
            out.append(dict(zip(headers, cells)))
        return out
    return []


def text(value):
    return str(value).strip() if value is not None else ""


def number(value):
    return float(value) if isinstance(value, (int, float)) else 0.0


def convert(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    sheet = lambda name: wb[name] if name in wb.sheetnames else None
    out = {"entries": [], "recurring": [], "installments": [], "goals": [], "debts": [], "extras": {"categories": [], "accounts": [], "people": []}}

    if ws := sheet("Lançamentos"):
        for i, row in enumerate(table(ws, "Data"), 1):
            date = iso(row.get("Data"))
            if not date or not number(row.get("Valor")):
                continue
            who = text(row.get("Quem"))
            if who and who.lower() != "casal" and who not in out["extras"]["people"]:
                out["extras"]["people"].append(who)
            out["entries"].append({
                "id": i,
                "date": date,
                "description": text(row.get("Descrição")),
                "category": text(row.get("Categoria")),
                "amount": number(row.get("Valor")),
                "account": text(row.get("Conta")),
                "status": "Pago" if text(row.get("Status")).lower() == "pago" else "Previsto",
                "responsible": who or "Casal",
                "type": "income" if text(row.get("Tipo")).lower() == "receita" else "expense",
            })

    if ws := sheet("Recorrentes"):
        for i, row in enumerate(table(ws, "Descrição"), 1):
            out["recurring"].append({
                "id": i,
                "description": text(row.get("Descrição")),
                "category": text(row.get("Categoria")),
                "account": text(row.get("Conta")),
                "day": int(number(row.get("Dia")) or 1),
                "amount": number(row.get("Valor")),
                "responsible": text(row.get("Quem")) or "Casal",
                "type": "income" if text(row.get("Tipo")).lower() == "receita" else "expense",
                "end": iso(row.get("Termina em")) or "",
                "active": text(row.get("Ativo")).lower() != "não",
            })

    if ws := sheet("Parcelamentos"):
        for i, row in enumerate(table(ws, "Compra"), 1):
            first = iso(row.get("Mês 1ª parcela"))
            if not first:
                continue
            out["installments"].append({
                "id": i,
                "description": text(row.get("Compra")),
                "category": text(row.get("Categoria")),
                "account": text(row.get("Conta")),
                "first": first,
                "amount": number(row.get("Valor parcela")),
                "count": int(number(row.get("Nº parcelas")) or 1),
                "paid": int(number(row.get("Já pagas"))),
            })

    if ws := sheet("Metas"):
        for row in table(ws, "Objetivo"):
            out["goals"].append({
                "description": text(row.get("Objetivo")),
                "target": number(row.get("Valor alvo")),
                "saved": number(row.get("Já guardado")),
                "deadline": iso(row.get("Prazo")),
            })

    if ws := sheet("Dívidas"):
        for row in table(ws, "Dívida"):
            out["debts"].append({
                "description": text(row.get("Dívida")),
                "balance": number(row.get("Saldo devedor")),
                "rate": number(row.get("Juros mensal")),
                "payment": number(row.get("Parcela")),
            })

    if ws := sheet("Cadastros"):
        for row in table(ws, "Categoria"):
            kind = text(row.get("Tipo")).lower()
            out["extras"]["categories"].append({
                "name": text(row.get("Categoria")),
                "kind": "income" if kind == "receita" else "expense",
                "group": GROUPS.get(text(row.get("Grupo")).lower()),
                "budget": number(row.get("Meta mensal")),
                "estimate": number(row.get("Variável estimado")),
            })
        for row in table(ws, "Conta"):
            out["extras"]["accounts"].append({
                "name": text(row.get("Conta")),
                "type": ACCOUNT_TYPES.get(text(row.get("Tipo")).lower(), "bank"),
                "opening": number(row.get("Saldo inicial")),
                "closingDay": int(number(row.get("Fechamento"))) or None,
                "dueDay": int(number(row.get("Vencimento"))) or None,
                "limit": number(row.get("Limite")),
            })

    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    data = convert(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"{len(data['entries'])} lançamentos, {len(data['recurring'])} recorrentes, "
          f"{len(data['installments'])} parcelamentos, {len(data['goals'])} metas, {len(data['debts'])} dívidas")
