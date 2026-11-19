export function download(name: string, content: Blob) {
  const href = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export type Cell = string | number;
export function csv(name: string, rows: Cell[][]) {
  const encode = (cell: Cell) => {
    const safe = typeof cell === "string" && /^[\s]*[=+\-@]/.test(cell) ? "'" + cell : String(cell);
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  download(name + ".csv", new Blob(["\ufeff" + rows.map(r => r.map(encode).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
}

export async function excel(name: string, rows: Cell[][]) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  const sheet = book.addWorksheet("Report");
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach(column => { column.width = 24; });
  const bytes = await book.xlsx.writeBuffer();
  download(name + ".xlsx", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
