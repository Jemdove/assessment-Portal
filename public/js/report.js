/* =====================================================
   STUDENT REPORT CARDS  (teacher in charge page only)
   - Click a student's name in the results table (or choose one from the
     list under the table) to see every subject, subject positions,
     overall position, number in class, attendance and remarks.
   - The report can be printed, or saved as PDF or Word.
   - Also runs the "Teachers & codes" button in the top bar.
   Put this file in:  public/js/report.js
   ===================================================== */
(function () {
  "use strict";

  // =====================================================
  // 1. "TEACHERS & CODES" BUTTON
  // =====================================================
  const teachersBtn = document.getElementById("teachersBtn");
  const teachersSection = document.getElementById("teachersSection");
  const teachersClose = document.getElementById("teachersClose");

  // Opens or closes the Teachers & codes pop-up
  function showTeachers(show) {
    if (!teachersSection) {
      return;
    }
    teachersSection.hidden = !show;
    document.body.classList.toggle("report-open", show); // stop the page behind from scrolling
    if (teachersBtn) {
      teachersBtn.setAttribute("aria-expanded", String(show));
    }
    if (show) {
      teachersSection.scrollTop = 0;
      if (teachersClose) {
        teachersClose.focus();
      }
    } else if (teachersBtn) {
      teachersBtn.focus();
    }
  }

  if (teachersBtn && teachersSection) {
    teachersBtn.addEventListener("click", function (e) {
      e.preventDefault();
      showTeachers(true);
    });

    // clicking the dark area outside the window closes it
    teachersSection.addEventListener("click", function (e) {
      if (e.target === teachersSection) {
        showTeachers(false);
      }
    });

    // the Escape key closes it
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !teachersSection.hidden) {
        showTeachers(false);
      }
    });
  }

  if (teachersClose) {
    teachersClose.addEventListener("click", function () {
      showTeachers(false);
    });
  }


  // =====================================================
  // 2. STUDENT REPORTS
  // =====================================================
  const resultRows = document.getElementById("resultRows");
  if (!resultRows) {
    return;
  }

  let data = null;       // the open class: { className, subjects, students, extras }
  let currentKey = "";   // which student's report is open
  let dirty = false;     // unsaved changes in the attendance/remarks form

  // ---------- small helpers ----------
  function esc(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  // "Kofi  Mensah" and "kofi mensah" are the same student
  function key(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  // 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd"
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function grade(score) {
    if (score >= 80) return { label: "Distinction", cls: "grade-distinction" };
    if (score >= 70) return { label: "Excellent", cls: "grade-excellent" };
    if (score >= 60) return { label: "Very Good", cls: "grade-very-good" };
    if (score >= 50) return { label: "Good", cls: "grade-good" };
    if (score >= 40) return { label: "Pass", cls: "grade-pass" };
    return { label: "Fail", cls: "grade-fail" };
  }

  // Position = 1 + how many did better, so equal scores share a position (1st, 2nd, 2nd, 4th)
  function rank(value, all) {
    return 1 + all.filter(function (v) {
      return v > value;
    }).length;
  }

  function currentClass() {
    const el = document.querySelector("#classArea .class-name");
    return el ? el.textContent.trim() : "";
  }

  function getJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error(body.error || "Something went wrong. Please try again.");
        }
        return body;
      });
    });
  }

  // ---------- work out every student's results ----------
  function buildClass(className, scores, extras) {
    const subjects = Object.keys(scores);
    const byKey = {};

    subjects.forEach(function (subject) {
      const list = scores[subject] || [];
      const all = list.map(function (s) { return s.score; });

      list.forEach(function (s) {
        const k = key(s.name);
        if (!byKey[k]) {
          byKey[k] = { key: k, name: String(s.name).trim(), results: {} };
        }
        byKey[k].results[subject] = {
          score: s.score,
          position: rank(s.score, all),
          outOf: list.length
        };
      });
    });

    const students = Object.values(byKey);

    students.forEach(function (st) {
      const values = Object.values(st.results).map(function (r) { return r.score; });
      st.taken = values.length;
      st.total = round(values.reduce(function (a, b) { return a + b; }, 0));
      st.average = st.taken ? round(st.total / st.taken) : 0;
    });

    const totals = students.map(function (s) { return s.total; });
    students.forEach(function (st) {
      st.position = rank(st.total, totals);
    });

    students.sort(function (a, b) {
      return a.position - b.position || a.name.localeCompare(b.name);
    });

    extras = extras || {};
    extras.students = extras.students || {};

    return { className: className, subjects: subjects, students: students, extras: extras };
  }

  function load() {
    const className = currentClass();
    if (!className) {
      return Promise.resolve(null);
    }
    const q = "?class=" + encodeURIComponent(className);
    return Promise.all([getJson("/api/scores" + q), getJson("/api/reports" + q)])
      .then(function (results) {
        data = buildClass(className, results[0], results[1]);
        return data;
      });
  }


  // ---------- make names in the results table clickable ----------
  function markNames() {
    if (!data) {
      return;
    }
    const known = {};
    data.students.forEach(function (s) {
      known[s.key] = true;
    });

    resultRows.querySelectorAll("td, th").forEach(function (cell) {
      if (known[key(cell.textContent)]) {
        cell.classList.add("student-link");
        cell.title = "Click to open this student's report";
        cell.tabIndex = 0;
      }
    });

    fillPicker();
  }

  // Every time the results table is redrawn (open class, refresh ...),
  // load the class again and mark the names
  let markTimer = null;
  new MutationObserver(function () {
    clearTimeout(markTimer);
    markTimer = setTimeout(function () {
      load().then(markNames).catch(function () { /* table still works without reports */ });
    }, 150);
  }).observe(resultRows, { childList: true, subtree: true });

  resultRows.addEventListener("click", function (e) {
    const cell = e.target.closest(".student-link");
    if (cell) {
      openReport(key(cell.textContent));
    }
  });

  resultRows.addEventListener("keydown", function (e) {
    const cell = e.target.closest(".student-link");
    if (cell && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openReport(key(cell.textContent));
    }
  });


  // ---------- "Student report" list under the table ----------
  const picker = document.createElement("div");
  picker.className = "report-picker no-print";
  picker.hidden = true;
  picker.innerHTML =
    "<p class=\"report-hint\">Click a student's name in the table, or choose one here, to see their full report.</p>" +
    "<label class=\"field\"><span class=\"field-label\">Student report</span>" +
    "<select id=\"reportSelect\" class=\"input\"><option value=\"\">Choose a student…</option></select></label>";
  (resultRows.closest(".table-wrap") || resultRows.parentNode).after(picker);

  const reportSelect = picker.querySelector("#reportSelect");

  function fillPicker() {
    const sorted = data.students.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    reportSelect.innerHTML = "<option value=\"\">Choose a student…</option>" +
      sorted.map(function (s) {
        return "<option value=\"" + esc(s.key) + "\">" + esc(s.name) + " (" + ordinal(s.position) + ")</option>";
      }).join("");
    picker.hidden = sorted.length === 0;
  }

  reportSelect.addEventListener("change", function () {
    const chosen = reportSelect.value;
    reportSelect.value = "";
    if (chosen) {
      openReport(chosen);
    }
  });


  // ---------- the report window ----------
  const modal = document.createElement("div");
  modal.id = "reportModal";
  modal.className = "report-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="report-panel" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
      <div class="report-toolbar no-print">
        <button type="button" class="btn btn-outline" data-act="prev">◀ Previous</button>
        <button type="button" class="btn btn-outline" data-act="next">Next ▶</button>
        <span class="report-toolbar-gap"></span>
        <button type="button" class="btn btn-primary" data-act="print">Print</button>
        <button type="button" class="btn btn-outline" data-act="pdf">Save as PDF</button>
        <button type="button" class="btn btn-outline" data-act="word">Save as Word</button>
        <button type="button" class="btn btn-outline" data-act="close">✕ Close</button>
      </div>

      <div id="reportSheet" class="report-sheet"></div>

      <form id="reportForm" class="report-edit no-print" autocomplete="off">
        <h3 class="report-edit-title">Attendance and remarks</h3>

        <p class="report-edit-note">For the whole class (the same on every student's report)</p>
        <div class="report-grid">
          <label class="field"><span class="field-label">Term</span>
            <input class="input" name="term" maxlength="40" placeholder="e.g. Term 1" /></label>
          <label class="field"><span class="field-label">Academic year</span>
            <input class="input" name="year" maxlength="20" placeholder="e.g. 2026/2027" /></label>
          <label class="field"><span class="field-label">Total school days</span>
            <input class="input" name="totalDays" type="number" min="0" max="1000" step="1" placeholder="e.g. 60" /></label>
          <label class="field"><span class="field-label">Next term begins</span>
            <input class="input" name="nextTerm" maxlength="40" placeholder="e.g. 12 January 2027" /></label>
        </div>

        <p class="report-edit-note">For this student only</p>
        <div class="report-grid">
          <label class="field"><span class="field-label">Days present</span>
            <input class="input" name="present" type="number" min="0" max="1000" step="1" placeholder="e.g. 55" /></label>
          <label class="field"><span class="field-label">Conduct</span>
            <input class="input" name="conduct" maxlength="60" placeholder="e.g. Very good" /></label>
          <label class="field"><span class="field-label">Interest</span>
            <input class="input" name="interest" maxlength="60" placeholder="e.g. Reading, football" /></label>
          <label class="field report-wide"><span class="field-label">Teacher's remark</span>
            <textarea class="input" name="remark" maxlength="300" rows="2" placeholder="e.g. Hardworking. Keep it up."></textarea></label>
        </div>

        <div class="report-edit-actions">
          <button class="btn btn-primary" type="submit">Save</button>
          <span id="reportMsg" class="message"></span>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const sheet = modal.querySelector("#reportSheet");
  const form = modal.querySelector("#reportForm");
  const msg = modal.querySelector("#reportMsg");
  const f = form.elements;

  function student() {
    return data && data.students.find(function (s) {
      return s.key === currentKey;
    });
  }

  function readForm() {
    return {
      term: f.term.value.trim(),
      year: f.year.value.trim(),
      totalDays: f.totalDays.value.trim(),
      nextTerm: f.nextTerm.value.trim(),
      present: f.present.value.trim(),
      conduct: f.conduct.value.trim(),
      interest: f.interest.value.trim(),
      remark: f.remark.value.trim()
    };
  }

  function fillForm() {
    const ex = data.extras;
    const mine = ex.students[currentKey] || {};
    f.term.value = ex.term || "";
    f.year.value = ex.year || "";
    f.totalDays.value = ex.totalDays === undefined ? "" : ex.totalDays;
    f.nextTerm.value = ex.nextTerm || "";
    f.present.value = mine.present === undefined ? "" : mine.present;
    f.conduct.value = mine.conduct || "";
    f.interest.value = mine.interest || "";
    f.remark.value = mine.remark || "";
    dirty = false;
    msg.textContent = "";
  }

  // Everything on one report, used by the page, PDF and Word versions
  function reportParts(st, info) {
    const n = data.students.length;

    let attendance = "—";
    if (info.totalDays !== "") {
      attendance = (info.present !== "" ? info.present : "—") + " out of " + info.totalDays + " days";
    } else if (info.present !== "") {
      attendance = info.present + " days";
    }

    return {
      name: st.name,
      title: "Student Report Card",
      subtitle: [data.className, info.term, info.year].filter(Boolean).join(" · "),
      details: [
        ["Student", st.name],
        ["Class", data.className],
        ["Number in class", String(n)],
        ["Overall position", ordinal(st.position)],
        ["Total score", st.total + " (" + st.taken + " of " + data.subjects.length + " subjects)"],
        ["Average score", st.average + " · " + grade(st.average).label],
        ["Attendance", attendance]
      ],
      rows: data.subjects.map(function (subject) {
        const r = st.results[subject];
        if (!r) {
          return { subject: subject, score: "—", grade: "No score", cls: "", position: "—" };
        }
        const g = grade(r.score);
        return {
          subject: subject,
          score: String(r.score),
          grade: g.label,
          cls: g.cls,
          position: ordinal(r.position)
        };
      }),
      remarks: [
        ["Conduct", info.conduct || "—"],
        ["Interest", info.interest || "—"],
        ["Teacher's remark", info.remark || "—"],
        ["Next term begins", info.nextTerm || "—"]
      ]
    };
  }

  function pairsHtml(list, cls) {
    return "<dl class=\"" + cls + "\">" + list.map(function (d) {
      return "<div><dt>" + esc(d[0]) + "</dt><dd>" + esc(d[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function sheetHtml(p) {
    const rows = p.rows.map(function (r) {
      const gradeCell = r.cls ? "<span class=\"grade " + r.cls + "\">" + esc(r.grade) + "</span>" : esc(r.grade);
      return "<tr><td>" + esc(r.subject) + "</td><td>" + esc(r.score) + "</td><td>" + gradeCell + "</td><td>" + esc(r.position) + "</td></tr>";
    }).join("");

    return `
      <header class="report-head">
        <img src="/images/logo.svg" alt="" />
        <div>
          <h2 id="reportTitle">${esc(p.title)}</h2>
          <p>${esc(p.subtitle)}</p>
        </div>
      </header>
      ${pairsHtml(p.details, "report-details")}
      <table class="report-table">
        <thead><tr><th>Subject</th><th>Score</th><th>Grade</th><th>Position in subject</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${pairsHtml(p.remarks, "report-remarks")}
      <div class="report-signs"><div>Class teacher</div><div>Teacher in charge</div></div>`;
  }

  function renderSheet() {
    const st = student();
    if (!st) {
      return;
    }
    sheet.innerHTML = sheetHtml(reportParts(st, readForm()));

    const i = data.students.indexOf(st);
    modal.querySelector("[data-act=prev]").disabled = i <= 0;
    modal.querySelector("[data-act=next]").disabled = i >= data.students.length - 1;
  }

  function okToLeave() {
    return !dirty || confirm("You have changes you haven't saved. Leave without saving?");
  }

  function showStudent(k) {
    currentKey = k;
    fillForm();
    renderSheet();
    modal.hidden = false;
    modal.scrollTop = 0;
    document.body.classList.add("report-open");
  }

  function openReport(k) {
    load()
      .then(function () {
        if (!data || !data.students.some(function (s) { return s.key === k; })) {
          alert("Could not find that student's scores. Click Refresh scores and try again.");
          return;
        }
        showStudent(k);
        modal.querySelector("[data-act=close]").focus();
      })
      .catch(function (error) {
        alert(error.message);
      });
  }

  function closeReport() {
    if (!okToLeave()) {
      return;
    }
    dirty = false;
    modal.hidden = true;
    document.body.classList.remove("report-open");
  }

  function move(step) {
    const st = student();
    const next = st && data.students[data.students.indexOf(st) + step];
    if (next && okToLeave()) {
      showStudent(next.key);
    }
  }

  function fileName(p) {
    return ("Report - " + p.name + " - " + data.className).replace(/[\\/:*?"<>|]+/g, "");
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function savePdf(p) {
    if (!window.jspdf) {
      alert("The PDF tool did not load. Check your internet connection and reload the page.");
      return;
    }
    const doc = new window.jspdf.jsPDF();
    const left = 14;

    doc.setFontSize(18);
    doc.text(p.title, left, 18);
    doc.setFontSize(11);
    doc.text(p.subtitle, left, 25);

    const plain = {
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 1.5 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 } }
    };

    doc.autoTable(Object.assign({ startY: 31, body: p.details }, plain));

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6,
      head: [["Subject", "Score", "Grade", "Position in subject"]],
      body: p.rows.map(function (r) { return [r.subject, r.score, r.grade, r.position]; }),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [37, 99, 235] }
    });

    doc.autoTable(Object.assign({ startY: doc.lastAutoTable.finalY + 6, body: p.remarks }, plain));

    let y = doc.lastAutoTable.finalY + 25;
    if (y > 280) {
      doc.addPage();
      y = 30;
    }
    doc.line(left, y, 90, y);
    doc.line(120, y, 196, y);
    doc.setFontSize(10);
    doc.text("Class teacher", left, y + 5);
    doc.text("Teacher in charge", 120, y + 5);

    doc.save(fileName(p) + ".pdf");
  }

  function saveWord(p) {
    const cell = "border:1px solid #999;padding:6px 8px;";
    const pairs = function (list) {
      return "<table>" + list.map(function (d) {
        return "<tr><td style=\"padding:3px 16px 3px 0;color:#555;\">" + esc(d[0]) +
          "</td><td style=\"padding:3px 0;\"><b>" + esc(d[1]) + "</b></td></tr>";
      }).join("") + "</table>";
    };
    const head = ["Subject", "Score", "Grade", "Position in subject"].map(function (h) {
      return "<th style=\"" + cell + "background:#f3f4f6;text-align:left;\">" + h + "</th>";
    }).join("");
    const rows = p.rows.map(function (r) {
      return "<tr>" + [r.subject, r.score, r.grade, r.position].map(function (v) {
        return "<td style=\"" + cell + "\">" + esc(v) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    const html =
      "<html><head><meta charset=\"utf-8\"><title>" + esc(p.title) + "</title></head>" +
      "<body style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt;\">" +
      "<h1 style=\"font-size:18pt;margin:0;\">" + esc(p.title) + "</h1>" +
      "<p style=\"margin:2px 0 12px;color:#444;\">" + esc(p.subtitle) + "</p>" +
      pairs(p.details) + "<br>" +
      "<table style=\"border-collapse:collapse;width:100%;\"><tr>" + head + "</tr>" + rows + "</table><br>" +
      pairs(p.remarks) + "<br><br><br>" +
      "<table style=\"width:100%;\"><tr>" +
      "<td style=\"border-top:1px solid #000;width:45%;padding-top:4px;\">Class teacher</td><td style=\"width:10%;\"></td>" +
      "<td style=\"border-top:1px solid #000;width:45%;padding-top:4px;\">Teacher in charge</td>" +
      "</tr></table></body></html>";

    download(new Blob(["\ufeff", html], { type: "application/msword" }), fileName(p) + ".doc");
  }

  // Toolbar buttons
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      closeReport();
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) {
      return;
    }
    const act = btn.getAttribute("data-act");
    const st = student();

    if (act === "close") closeReport();
    if (act === "prev") move(-1);
    if (act === "next") move(1);
    if (act === "print") {
      document.body.classList.add("printing-report");
      window.print();
    }
    if (act === "pdf" && st) savePdf(reportParts(st, readForm()));
    if (act === "word" && st) saveWord(reportParts(st, readForm()));
  });

  window.addEventListener("afterprint", function () {
    document.body.classList.remove("printing-report");
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) {
      closeReport();
    }
  });

  // Typing in the form updates the report straight away
  form.addEventListener("input", function () {
    dirty = true;
    msg.textContent = "";
    renderSheet();
  });

  // Save attendance and remarks
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const st = student();
    const info = readForm();

    if (info.totalDays !== "" && info.present !== "" && Number(info.present) > Number(info.totalDays)) {
      msg.textContent = "Days present can't be more than the total school days.";
      return;
    }

    msg.textContent = "Saving…";

    getJson("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        className: data.className,
        term: info.term,
        year: info.year,
        totalDays: info.totalDays,
        nextTerm: info.nextTerm,
        student: {
          name: st.name,
          present: info.present,
          conduct: info.conduct,
          interest: info.interest,
          remark: info.remark
        }
      })
    })
      .then(function (result) {
        data.extras = result.report;
        data.extras.students = data.extras.students || {};
        dirty = false;
        msg.textContent = "Saved ✓";
      })
      .catch(function (error) {
        msg.textContent = error.message;
      });
  });
})();
