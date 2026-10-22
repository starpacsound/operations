// =====================================================================
// Shared PDF report layout (jsPDF + AutoTable): branded header band, running header on later pages,
// "Page x of y" footer. Used by Log History and Inventory Check history.
// =====================================================================

// jsPDF's built-in fonts only cover Latin-1, so swap symbols for plain text.
const pdfText = s => String(s === undefined || s === null ? "" : s)
    .replace(/[→⇒]/g, "->").replace(/[←]/g, "<-").replace(/[×]/g, "x").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-").replace(/[·•]/g, "|").replace(/∅/g, "(blank)").replace(/…/g, "...").replace(/✓/g, "Yes").replace(/✗/g, "No")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

async function logoAsPng() {
    const src = settings.app && settings.app.logo;
    if (!src) return null;
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas");
            c.width = 128; c.height = 128;
            const ctx = c.getContext("2d");
            const s = Math.min(128 / img.width, 128 / img.height);
            ctx.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
            resolve(c.toDataURL("image/png"));
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

const pdfDate = (d, withTime) => {
    const x = new Date(String(d).length === 10 ? d + "T00:00:00" : d);
    if (isNaN(x)) return pdfText(d || "");
    return x.toLocaleString(undefined, withTime ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" });
};

// Starts an A4 report. meta: up to 3 short lines shown top-right.
async function newReport({ title, orientation, meta }) {
    const jsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDF) throw new Error("The PDF library didn't load. Reload the page and try again.");
    const doc = new jsPDF({ orientation: orientation || "landscape", unit: "mm", format: "a4" });
    if (typeof doc.autoTable !== "function") throw new Error("The PDF table plugin didn't load. Reload the page and try again.");
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
    const name = pdfText(appName());
    const generated = pdfDate(new Date().toISOString(), true);
    const logo = await logoAsPng();

    doc.setFillColor(42, 47, 55);
    doc.rect(0, 0, W, 30, "F");
    let x = M;
    if (logo) { doc.addImage(logo, "PNG", M, 6, 18, 18); x = M + 22; }
    doc.setTextColor(241, 243, 246); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(name, x, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(211, 216, 223);
    doc.text(pdfText(title), x, 20.5);
    doc.setFontSize(8.5);
    const lines = [`Generated ${generated} by ${myName()} (${myEmail()})`, ...(meta || [])].slice(0, 3);
    lines.forEach((l, i) => doc.text(pdfText(l), W - M, 13 + i * 5.5, { align: "right" }));

    const ctx = {
        doc, W, H, M, y: 36, name, generated, title,
        // A titled block of label/value pairs (e.g. round summary)
        facts(pairs) {
            const colW = (W - 2 * M) / Math.min(pairs.length, 5);
            pairs.forEach(([label, value], i) => {
                const cx = M + (i % 5) * colW, cy = ctx.y + Math.floor(i / 5) * 14;
                doc.setFontSize(7.5); doc.setTextColor(95, 105, 120); doc.setFont("helvetica", "normal");
                doc.text(pdfText(label).toUpperCase(), cx, cy);
                doc.setTextColor(30, 35, 42); doc.setFont("helvetica", "bold");
                let size = 12;
                doc.setFontSize(size);
                while (doc.getTextWidth(pdfText(value)) > colW - 4 && size > 7) { size -= 0.5; doc.setFontSize(size); }
                doc.text(pdfText(value), cx, cy + 6);
            });
            ctx.y += Math.ceil(pairs.length / 5) * 14 + 2;
        },
        heading(text) {
            doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(30, 35, 42);
            doc.text(pdfText(text), M, ctx.y + 4);
            ctx.y += 7;
        },
        table(opts) {
            doc.autoTable({
                startY: ctx.y, margin: { left: M, right: M, top: 18, bottom: 14 },
                styles: { font: "helvetica", fontSize: 7.8, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, textColor: [40, 44, 52], lineColor: [221, 225, 231], lineWidth: 0.1, valign: "top", overflow: "linebreak" },
                headStyles: { fillColor: [58, 65, 77], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.8 },
                alternateRowStyles: { fillColor: [245, 247, 250] },
                ...opts,
                didDrawPage: data => {
                    if (data.pageNumber > 1) {
                        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(58, 65, 77);
                        doc.text(`${name} | ${pdfText(title)}`, M, 11);
                        doc.setFont("helvetica", "normal"); doc.setTextColor(120, 130, 146);
                        doc.text(`Generated ${generated}`, W - M, 11, { align: "right" });
                    }
                    doc.setFontSize(7.5); doc.setTextColor(120, 130, 146); doc.setFont("helvetica", "normal");
                    doc.text("Internal use only", M, H - 6);
                    doc.text(`Page ${data.pageNumber} of {total}`, W - M, H - 6, { align: "right" });
                }
            });
            ctx.y = doc.lastAutoTable.finalY + 8;
        },
        async save(filename) {
            doc.putTotalPages("{total}");
            const blob = doc.output("blob");
            await saveFile(filename, blob);
            return blob;
        }
    };
    return ctx;
}
