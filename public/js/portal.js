// =====================================================
// SUBJECT TEACHER PORTAL (success.html)
// =====================================================

// The subject comes from the server, which knows who signed in
let subject = "";

// Students in the open class: { name: "Ama Owusu", score: 85 }
let students = [];

// true when there are scores the teacher has not sent yet
let unsent = false;

const form = document.getElementById("scoreForm");
const nameInput = document.getElementById("studentName");
const scoreInput = document.getElementById("studentScore");
const tableBody = document.getElementById("scoreRows");
const countText = document.getElementById("count");


// ---------- Find out who signed in, then start the class picker ----------
getJson("/api/me").then(function (me) {
  subject = me.role;

  document.title = subject + " Scores";
  document.getElementById("teacherName").textContent = me.name;
  document.querySelectorAll(".subject-name").forEach(function (place) {
    place.textContent = subject;
  });

  setupClassBar(loadClass);
});


// ---------- Open a class: load the scores already sent for it ----------
function loadClass(className) {
  if (unsent && className !== currentClass) {
    const leave = confirm("You have " + currentClass + " scores you have not sent yet. Leave them?");
    if (!leave) {
      return false;
    }
  }

  students = [];
  unsent = false;
  showTable();
  showMessage("", "success");

  getJson("/api/scores?class=" + encodeURIComponent(className)).then(function (classScores) {
    // the teacher may have clicked another class while this was loading
    if (className !== currentClass) {
      return;
    }
    students = classScores[subject] || [];
    showTable();
  });
}

// Warn before closing the page with unsent scores
window.addEventListener("beforeunload", function (event) {
  if (unsent) {
    event.preventDefault();
  }
});


// ---------- Typing a score ----------
form.addEventListener("submit", function (event) {
  event.preventDefault();
  addStudent(nameInput.value, Number(scoreInput.value));
  form.reset();
  nameInput.focus();
});


function addStudent(name, score) {
  name = name.trim();

  if (name === "" || isNaN(score) || score < 0 || score > 100) {
    showMessage("Please give a name and a score from 0 to 100.", "error");
    return;
  }

  // Same name again? Update the score instead of adding twice.
  const existing = students.find(function (student) {
    return student.name.toLowerCase() === name.toLowerCase();
  });

  if (existing) {
    existing.score = score;
  } else {
    students.push({ name: name, score: score });
  }

  unsent = true;
  showMessage("Saved " + name + ": " + score + " (not sent yet)", "success");
  showTable();
}


function removeStudent(name) {
  students = students.filter(function (student) {
    return student.name !== name;
  });
  unsent = true;
  showTable();
}


// ---------- Build the ranked table ----------
function showTable() {
  addPositions(students, "score");
  tableBody.innerHTML = "";

  students.forEach(function (student) {
    const grade = getGrade(student.score);
    const row = document.createElement("tr");
    row.dataset.position = student.position;

    row.innerHTML =
      "<td>" + ordinal(student.position) + "</td>" +
      "<td>" + clean(student.name) + "</td>" +
      "<td>" + student.score + "</td>" +
      "<td><span class='" + gradeClass(grade) + "'>" + grade + "</span></td>" +
      "<td class='no-print'><button type='button' class='btn btn-outline btn-small'>Remove</button></td>";

    row.querySelector("button").addEventListener("click", function () {
      removeStudent(student.name);
    });

    tableBody.appendChild(row);
  });

  countText.textContent = students.length;
}


// ---------- Send to the teacher in charge ----------
document.getElementById("sendBtn").addEventListener("click", function () {
  if (students.length === 0) {
    showMessage("Add some scores before sending.", "error");
    return;
  }

  const list = students.map(function (student) {
    return { name: student.name, score: student.score };
  });

  fetch("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ className: currentClass, students: list })
  }).then(function (response) {
    if (response.status === 401 || response.status === 403) {
      window.location.href = "/";
    } else if (response.ok) {
      unsent = false;
      showMessage("All " + subject + " scores for " + currentClass + " sent to the teacher in charge.", "success");
    } else {
      showMessage("Could not send the scores. Please try again.", "error");
    }
  }).catch(function () {
    showMessage("Could not reach the server. Is it running?", "error");
  });
});


// ---------- Save and print ----------
document.getElementById("wordBtn").addEventListener("click", function () {
  saveAsWord("scoreTable", currentClass + " - " + subject + " Results");
});

document.getElementById("pdfBtn").addEventListener("click", function () {
  saveAsPdf("scoreTable", currentClass + " - " + subject + " Results", false);
});

document.getElementById("printBtn").addEventListener("click", function () {
  window.print();
});


// =====================================================
// VOICE INPUT
// Say: "Ama Owusu 85"  or  "Kofi Mensah 70, Esi Boateng 92"
// Works in Chrome and Edge.
// =====================================================
const voiceBtn = document.getElementById("voiceBtn");
const voiceStatus = document.getElementById("voiceStatus");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  voiceBtn.disabled = true;
  voiceStatus.textContent = "Voice input needs Google Chrome or Microsoft Edge.";
} else {
  const listener = new SpeechRecognition();
  listener.lang = "en-GB";
  listener.continuous = true;
  listener.interimResults = false;

  let listening = false;

  voiceBtn.addEventListener("click", function () {
    if (listening) {
      listener.stop();
    } else {
      listener.start();
    }
  });

  listener.onstart = function () {
    listening = true;
    voiceBtn.classList.add("listening");
    voiceBtn.textContent = "Stop listening";
    voiceStatus.textContent = "Listening… say a name, then the score.";
  };

  listener.onend = function () {
    listening = false;
    voiceBtn.classList.remove("listening");
    voiceBtn.textContent = "Start voice input";
  };

  listener.onerror = function (event) {
    showMessage("Voice problem: " + event.error + ". Check the microphone permission.", "error");
  };

  listener.onresult = function (event) {
    const said = event.results[event.results.length - 1][0].transcript.trim();
    voiceStatus.textContent = "Heard: \"" + said + "\"";
    readSpeech(said);
  };
}


// Find every "name + number" pair in what was said
function readSpeech(said) {
  const pairs = [...said.matchAll(/([A-Za-z][A-Za-z' -]*?)\s*(\d+(?:\.\d+)?)/g)];

  if (pairs.length === 0) {
    showMessage("I heard \"" + said + "\" but no score. Say the name, then the number.", "error");
    return;
  }

  pairs.forEach(function (pair) {
    addStudent(tidyName(pair[1]), Number(pair[2]));
  });
}


// Remove filler words and capitalise: "ama owusu scored" -> "Ama Owusu"
function tidyName(text) {
  return text
    .replace(/\b(scored|scores|score|got|gets|has|is|marks|mark|and|percent)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
}
