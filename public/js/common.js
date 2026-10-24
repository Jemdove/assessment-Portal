// =====================================================
// Shared code used by BOTH portals
// =====================================================

// The 10 subjects.
// If you rename one, rename it in signup.html too.
const SUBJECTS = [
  "Mathematics",
  "English Language",
  "Integrated Science",
  "Social Studies",
  "Computing (ICT)",
  "French",
  "Religious and Moral Education",
  "Creative Arts",
  "Career Technology",
  "Ghanaian Language"
];


// Get data from the server.
// If the teacher is not signed in (or not allowed), go back to the sign-in page.
function getJson(url) {
  return fetch(url).then(function (response) {
    if (response.status === 401 || response.status === 403) {
      window.location.href = "/";
      throw new Error("Not signed in");
    }
    return response.json();
  });
}


// =====================================================
// CLASS PICKER (the same on both portals)
// =====================================================
let classNames = [];     // every class name the server knows
let currentClass = "";   // the class that is open now
let onClassOpen = null;  // what the portal does when a class opens

// Start the class picker. "openHandler" loads that class's scores.
function setupClassBar(openHandler) {
  onClassOpen = openHandler;

  document.getElementById("classForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const input = document.getElementById("classInput");
    openClass(input.value);
    input.value = "";
  });

  reloadClassList().then(function () {
    // open the first class straight away
    if (classNames.length > 0) {
      openClass(classNames[0]);
    }
  });
}

// Ask the server for the class names again
function reloadClassList() {
  return getJson("/api/classes").then(function (names) {
    names.forEach(function (name) {
      if (!classNames.includes(name)) {
        classNames.push(name);
      }
    });
    drawClassTabs();
  });
}

function openClass(name) {
  // "jhs  1a " -> "JHS 1A"
  name = name.trim().replace(/\s+/g, " ").toUpperCase();
  if (name === "") {
    return;
  }

  // "jhs 1a" opens the existing "JHS 1A"
  const existing = classNames.find(function (c) {
    return c.toLowerCase() === name.toLowerCase();
  });
  if (existing) {
    name = existing;
  }

  // The portal can say "no" (e.g. unsent scores)
  if (onClassOpen(name) === false) {
    return;
  }

  if (!existing) {
    classNames.push(name);
  }

  currentClass = name;
  drawClassTabs();
  document.getElementById("classArea").hidden = false;
  document.querySelectorAll(".class-name").forEach(function (place) {
    place.textContent = name;
  });
}

// Remove a class from the picker (after it is deleted)
function forgetClass(name) {
  classNames = classNames.filter(function (c) {
    return c !== name;
  });
  currentClass = "";
  document.getElementById("classArea").hidden = true;
  drawClassTabs();
}

// One button per class, plus the suggestions under the class box
function drawClassTabs() {
  const tabs = document.getElementById("classTabs");
  const options = document.getElementById("classOptions");
  tabs.innerHTML = "";
  options.innerHTML = "";

  // JHS 1A, JHS 1B, JHS 2A ... (numbers in the right order)
  classNames.sort(function (a, b) {
    return a.localeCompare(b, undefined, { numeric: true });
  });

  classNames.forEach(function (name) {
    const option = document.createElement("option");
    option.value = name;
    options.appendChild(option);

    const tab = document.createElement("button");
    tab.type = "button";
    tab.textContent = name;
    tab.className = name === currentClass ? "tab tab-active" : "tab";
    tab.addEventListener("click", function () {
      openClass(name);
    });
    tabs.appendChild(tab);
  });
}


// Turn a score (0-100) into a grade word
function getGrade(score) {
  if (score >= 80) {
    return "Distinction";
  }
  if (score >= 70) {
    return "Excellent";
  }
  if (score >= 60) {
    return "Very Good";
  }
  if (score >= 50) {
    return "Good";
  }
  if (score >= 40) {
    return "Pass";
  }
  return "Fail";
}


// "Very Good" -> "grade grade-very-good" (the colour classes in styles.css)
function gradeClass(grade) {
  return "grade grade-" + grade.toLowerCase().replace(" ", "-");
}


// Sort from highest to lowest and give each item a position.
// Equal scores share a position: 1, 2, 2, 4 ...
function addPositions(list, key) {
  list.sort(function (a, b) {
    return b[key] - a[key];
  });

  list.forEach(function (item, index) {
    if (index > 0 && item[key] === list[index - 1][key]) {
      item.position = list[index - 1].position;
    } else {
      item.position = index + 1;
    }
  });

  return list;
}


// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th"
function ordinal(number) {
  const endings = ["th", "st", "nd", "rd"];
  const lastTwo = number % 100;
  return number + (endings[(lastTwo - 20) % 10] || endings[lastTwo] || endings[0]);
}


// Make text safe to put inside HTML
function clean(text) {
  const box = document.createElement("div");
  box.textContent = text;
  return box.innerHTML;
}


// Show a green or red message under the buttons
function showMessage(text, type) {
  const message = document.getElementById("message");
  message.textContent = text;
  message.className = "message no-print message-" + type;
}


// Copy of a table without the parts marked "no-print"
function tableForExport(tableId) {
  const copy = document.getElementById(tableId).cloneNode(true);
  copy.querySelectorAll(".no-print").forEach(function (part) {
    part.remove();
  });
  return copy;
}


// Download the table as a Word file (.doc)
function saveAsWord(tableId, title) {
  const table = tableForExport(tableId);
  table.setAttribute("border", "1");
  table.setAttribute("cellpadding", "6");

  const page =
    "<html><head><meta charset='utf-8'></head><body>" +
    "<h2>" + clean(title) + "</h2>" +
    table.outerHTML +
    "</body></html>";

  const file = new Blob([page], { type: "application/msword" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = title + ".doc";
  link.click();
}


// Download the table as a PDF file
function saveAsPdf(tableId, title, landscape) {
  const pdf = new window.jspdf.jsPDF({
    orientation: landscape ? "landscape" : "portrait"
  });

  pdf.setFontSize(16);
  pdf.text(title, 14, 16);

  pdf.autoTable({
    html: tableForExport(tableId),
    startY: 22,
    styles: { fontSize: landscape ? 7 : 10 },
    headStyles: { fillColor: [79, 70, 229] }
  });

  pdf.save(title + ".pdf");
}
