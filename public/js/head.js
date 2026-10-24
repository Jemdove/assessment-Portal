// =====================================================
// TEACHER IN CHARGE PORTAL (head.html)
// =====================================================

const headRow = document.getElementById("headRow");
const resultRows = document.getElementById("resultRows");
const statusBox = document.getElementById("subjectStatus");


// ---------- Table heading: Position, Student, 10 subjects, Total ... ----------
function buildHeading() {
  let html = "<th>Position</th><th>Student</th>";

  SUBJECTS.forEach(function (subject) {
    html += "<th>" + subject + "</th>";
  });

  html += "<th>Total</th><th>Average</th><th>Overall Grade</th>";
  headRow.innerHTML = html;
}


// ---------- Open a class: get every subject's scores for it ----------
function loadClass(className) {
  getJson("/api/scores?class=" + encodeURIComponent(className))
    .then(function (classScores) {
      // the teacher may have clicked another class while this was loading
      if (className !== currentClass) {
        return;
      }
      showStatus(classScores);
      showResults(classScores);
    })
    .catch(function () {
      showMessage("Could not reach the server. Is it running?", "error");
    });
}


// Green chip = subject sent, grey chip = still waiting
function showStatus(classScores) {
  statusBox.innerHTML = "";

  SUBJECTS.forEach(function (subject) {
    const chip = document.createElement("span");
    chip.className = classScores[subject] ? "chip chip-done" : "chip";
    chip.textContent = subject;
    statusBox.appendChild(chip);
  });
}


// ---------- Combine all subjects for each student ----------
function showResults(classScores) {
  const students = {};

  SUBJECTS.forEach(function (subject) {
    const list = classScores[subject] || [];

    list.forEach(function (entry) {
      const key = entry.name.trim().toLowerCase();

      if (!students[key]) {
        students[key] = { name: entry.name.trim(), scores: {} };
      }

      students[key].scores[subject] = entry.score;
    });
  });

  const list = Object.values(students);

  list.forEach(function (student) {
    const marks = Object.values(student.scores);
    student.total = marks.reduce(function (sum, mark) {
      return sum + mark;
    }, 0);
    student.average = student.total / marks.length;
  });

  // Highest total = 1st
  addPositions(list, "total");

  resultRows.innerHTML = "";

  list.forEach(function (student) {
    const row = document.createElement("tr");
    row.dataset.position = student.position;

    let html =
      "<td>" + ordinal(student.position) + "</td>" +
      "<td>" + clean(student.name) + "</td>";

    SUBJECTS.forEach(function (subject) {
      const score = student.scores[subject];

      if (score === undefined) {
        html += "<td><span class='missing'>–</span></td>";
      } else {
        const grade = getGrade(score);
        html +=
          "<td><span class='cell-score'>" + score + "</span> " +
          "<span class='" + gradeClass(grade) + "'>" + grade + "</span></td>";
      }
    });

    const overall = getGrade(student.average);

    html +=
      "<td><strong>" + student.total + "</strong></td>" +
      "<td>" + student.average.toFixed(1) + "</td>" +
      "<td><span class='" + gradeClass(overall) + "'>" + overall + "</span></td>";

    row.innerHTML = html;
    resultRows.appendChild(row);
  });

  document.getElementById("count").textContent = list.length;
}


// ---------- Buttons ----------
document.getElementById("refreshBtn").addEventListener("click", function () {
  reloadClassList();
  loadClass(currentClass);
  showMessage("Scores refreshed.", "success");
});

document.getElementById("wordBtn").addEventListener("click", function () {
  saveAsWord("resultTable", currentClass + " - Results for All Subjects");
});

document.getElementById("pdfBtn").addEventListener("click", function () {
  saveAsPdf("resultTable", currentClass + " - Results for All Subjects", true);
});

document.getElementById("printBtn").addEventListener("click", function () {
  window.print();
});

document.getElementById("clearBtn").addEventListener("click", function () {
  const name = currentClass;

  if (!confirm("Delete ALL scores for " + name + " in every subject? This cannot be undone.")) {
    return;
  }

  fetch("/api/scores?class=" + encodeURIComponent(name), { method: "DELETE" }).then(function () {
    forgetClass(name);
  });
});


// =====================================================
// TEACHERS AND ONE-TIME CODES
// =====================================================
const teacherRows = document.getElementById("teacherRows");
const codeBox = document.getElementById("codeBox");

function loadTeachers() {
  getJson("/api/teachers").then(function (teachers) {
    teacherRows.innerHTML = "";

    teachers.forEach(function (teacher) {
      const row = document.createElement("tr");

      row.innerHTML =
        "<td>" + clean(teacher.name || "–") + "</td>" +
        "<td>" + clean(teacher.email) + "</td>" +
        "<td>" + clean(teacher.role) + "</td>" +
        "<td><span class='status status-" + teacher.statusKey + "'>" + teacher.status + "</span></td>" +
        "<td><button type='button' class='btn btn-outline btn-small'>Give code</button></td>";

      row.querySelector("button").addEventListener("click", function () {
        giveCode(teacher);
      });

      teacherRows.appendChild(row);
    });
  });
}

function giveCode(teacher) {
  const who = teacher.name || teacher.email;

  if (!confirm("Make a one-time code for " + who + "? Any older code for them will stop working.")) {
    return;
  }

  fetch("/api/teachers/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: teacher.email })
  })
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (data.error) {
        codeBox.textContent = data.error;
        return;
      }

      codeBox.innerHTML =
        "Code for <strong>" + clean(who) + "</strong>: " +
        "<span class='code'>" + clean(data.code) + "</span>" +
        "Tell them in person. It works once, for 24 hours. " +
        "They enter it on the sign-in page under <strong>\"Got a code from the teacher in charge?\"</strong>";
    });
}


// ---------- Start ----------
loadTeachers();

getJson("/api/me").then(function (me) {
  document.getElementById("teacherName").textContent = me.name;
});

buildHeading();
setupClassBar(loadClass);
