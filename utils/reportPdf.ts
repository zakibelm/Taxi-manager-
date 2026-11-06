import type { Service } from '../types';

/** Rapport PDF des courses affichées (filtres appliqués) : synthèse par type + détail. Généré dans le navigateur, rien n'est envoyé. */
export async function buildReportPdf(rows: Service[], who: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const money = (n: number) => n.toFixed(2).replace('.', ',') + ' $ CA';
  const left = 14, right = 202;
  let y = 18;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text('Rapport des courses - Taxi Manager', left, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const from = sorted[0]?.date.slice(0, 10) ?? '-', to = sorted[sorted.length - 1]?.date.slice(0, 10) ?? '-';
  doc.text(`Periode : ${from} au ${to}   |   Genere le ${new Date().toLocaleDateString('en-CA')}   |   ${who}`, left, y); y += 9;

  const total = sorted.reduce((s, r) => s + r.amount, 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(`${sorted.length} course(s) - Total ${money(total)}`, left, y); y += 7;

  const byType = new Map<string, { n: number; sum: number }>();
  for (const r of sorted) { const t = byType.get(r.type) ?? { n: 0, sum: 0 }; t.n++; t.sum += r.amount; byType.set(r.type, t); }
  doc.setFontSize(10);
  for (const [type, t] of [...byType].sort((a, b) => b[1].sum - a[1].sum)) {
    doc.setFont('helvetica', 'normal');
    doc.text(`${type} (${t.n})`, left + 2, y); doc.text(money(t.sum), right, y, { align: 'right' }); y += 5;
  }
  y += 4;

  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Date', left, y); doc.text('Type', left + 24, y); doc.text('Note', left + 78, y);
    doc.text('Montant', right, y, { align: 'right' });
    y += 2; doc.line(left, y, right, y); y += 5;
  };
  header();
  doc.setFont('helvetica', 'normal');
  for (const r of sorted) {
    if (y > 270) { doc.addPage(); y = 18; header(); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(r.date.slice(0, 10), left, y);
    doc.text(doc.splitTextToSize(r.type, 50)[0] ?? '', left + 24, y);
    doc.text(doc.splitTextToSize((r.description ?? '') + (r.pending ? ' (en attente)' : ''), 85)[0] ?? '', left + 78, y);
    doc.text(money(r.amount), right, y, { align: 'right' }); y += 5;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.text(`Page ${i}/${pages}`, right, 276, { align: 'right' }); }
  return doc.output('blob');
}
