// Reads your settings from the .env file next to this app.js
// (works even if you start the server from another folder)
require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");

const app = express();

// The address teachers type to open the portal (used inside email links)
const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Files (kept outside "public" so the browser can never open them)
const SCORES_FILE = __dirname + "/scores-by-class.json"; // all scores, class by class
const TEACHERS_FILE = __dirname + "/teachers.json";      // approved emails + roles (you edit this)
const ACCOUNTS_FILE = __dirname + "/accounts.json";      // names + scrambled passwords (made automatically)
const CODES_FILE = __dirname + "/codes.json";            // one-time codes from the teacher in charge (made automatically)
const REPORTS_FILE = __dirname + "/reports.json";        // NEW: attendance + remarks for report cards (made automatically)

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Remembers who is signed in (for 8 hours)
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-to-any-long-random-text",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));


// =====================================================
// FILE HELPERS
// =====================================================
function readJson(file, empty) {
  if (!fs.existsSync(file)) {
    return empty;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Find an email on the approved list
function findApproved(email) {
  return readJson(TEACHERS_FILE, []).find(function (t) {
    return t.email.toLowerCase() === email;
  });
}

// Make text safe to show on a page
function safe(text) {
  return String(text).replace(/[<>&"]/g, "");
}


// =====================================================
// SENDING EMAILS
// Uses the Gmail account in your .env file.
// No email settings yet? The email is printed in the terminal instead.
// =====================================================
let mailer = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER.trim(),
      // Google shows App passwords with spaces ("abcd efgh ..."); remove them
      pass: process.env.EMAIL_PASS.replace(/\s/g, "")
    }
  });
}

// Check the Gmail login once when the server starts, and say what happened
function checkEmailSettings() {
  if (!mailer) {
    console.log("EMAIL: No email settings found in " + __dirname + "/.env");
    console.log("       Emails will be PRINTED HERE instead of sent.");
    return;
  }

  mailer.verify(function (error) {
    if (error && error.code === "EAUTH") {
      console.log("EMAIL: Gmail REFUSED the login: " + error.message);
      console.log("       Check that EMAIL_PASS is a 16-letter App password (not your normal Gmail password)");
      console.log("       and that EMAIL_USER is the same Gmail account that made the App password.");
    } else if (error) {
      console.log("EMAIL: Could not reach Gmail: " + error.message);
      console.log("       Check your internet connection (or a firewall/antivirus blocking port 465/587).");
    } else {
      console.log("EMAIL: Ready. Sending from " + process.env.EMAIL_USER);
    }
  });
}

function sendEmail(to, subject, text) {
  if (!mailer) {
    console.log("\n----- EMAIL (not sent: add your email settings to .env) -----");
    console.log("To: " + to);
    console.log("Subject: " + subject);
    console.log(text);
    console.log("------------------------------------------------------------\n");
    return;
  }

  mailer.sendMail({
    from: "\"Assessment Portal\" <" + process.env.EMAIL_USER.trim() + ">",
    to: to,
    subject: subject,
    text: text
  }).then(function () {
    console.log("EMAIL: Sent \"" + subject + "\" to " + to);
  }).catch(function (error) {
    console.log("EMAIL: Sending to " + to + " FAILED: " + error.message);
  });
}


// =====================================================
// PASSWORDS AND EMAIL LINKS
// We never save the real password or link code, only scrambled versions.
// =====================================================
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function setPassword(account, password) {
  account.salt = crypto.randomBytes(16).toString("hex");
  account.hash = hashPassword(password, account.salt);
}

function passwordMatches(password, account) {
  const tried = Buffer.from(hashPassword(password, account.salt), "hex");
  const saved = Buffer.from(account.hash, "hex");
  return crypto.timingSafeEqual(tried, saved);
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

// Make a one-time link code ("verify" or "reset") that expires
function giveLinkCode(account, type, minutes) {
  const code = crypto.randomBytes(32).toString("hex");
  account.linkType = type;
  account.linkHash = sha256(code);
  account.linkExpires = Date.now() + minutes * 60 * 1000;
  return code;
}

function findByLinkCode(accounts, type, code) {
  const hash = sha256(code || "");
  return accounts.find(function (a) {
    return a.linkType === type && a.linkHash === hash && a.linkExpires > Date.now();
  });
}

function clearLinkCode(account) {
  delete account.linkType;
  delete account.linkHash;
  delete account.linkExpires;
}

// Password rules shared by sign-up and reset. Returns an error, or "" if fine.
function passwordProblem(password, confirm) {
  if (password !== confirm) {
    return "The two passwords you typed are different.";
  }
  if (password.length < 6) {
    return "Your password must have at least 6 characters.";
  }
  return "";
}


// =====================================================
// MESSAGE PAGE (errors, "check your email" ...)
// =====================================================
function showMessage(res, icon, title, text, link, button) {
  const page = fs.readFileSync(__dirname + "/message.html", "utf8")
    .replaceAll("{{ICON}}", icon)
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{TEXT}}", text)
    .replaceAll("{{LINK}}", link)
    .replaceAll("{{BUTTON}}", button);
  res.send(page);
}


// =====================================================
// GUARDS: who may open what
// =====================================================

// Only the teacher in charge of all scores
function headOnly(req, res, next) {
  const teacher = req.session.teacher;

  if (teacher && teacher.role === "head") {
    return next();
  }
  if (req.path.startsWith("/api")) {
    return res.status(403).json({ error: "Not allowed" });
  }
  res.redirect(teacher ? "/success" : "/");
}

// Only subject teachers
function subjectOnly(req, res, next) {
  const teacher = req.session.teacher;

  if (teacher && teacher.role !== "head") {
    return next();
  }
  if (req.path.startsWith("/api")) {
    return res.status(403).json({ error: "Not allowed" });
  }
  res.redirect(teacher ? "/head" : "/");
}

// Anyone who has signed in
function signedIn(req, res, next) {
  if (req.session.teacher) {
    return next();
  }
  res.status(401).json({ error: "Please sign in" });
}

// Where each role goes after signing in
function homeFor(teacher) {
  return teacher.role === "head" ? "/head" : "/success";
}


// =====================================================
// PAGES
// =====================================================

// Sign-in page (already signed in? go straight to your portal)
app.get("/", function (req, res) {
  if (req.session.teacher) {
    return res.redirect(homeFor(req.session.teacher));
  }
  res.sendFile(__dirname + "/signin.html");
});

app.get("/signup", function (req, res) {
  res.sendFile(__dirname + "/signup.html");
});

app.get("/forgot", function (req, res) {
  res.sendFile(__dirname + "/forgot.html");
});

app.get("/code", function (req, res) {
  res.sendFile(__dirname + "/code.html");
});

app.get("/success", subjectOnly, function (req, res) {
  res.sendFile(__dirname + "/success.html");
});

app.get("/head", headOnly, function (req, res) {
  res.sendFile(__dirname + "/head.html");
});


// =====================================================
// SIGN UP (first time only)
// The account only works after the teacher clicks the link sent to their email.
// This proves the email really belongs to them.
// =====================================================
app.post("/signup", function (req, res) {
  const name = safe((req.body.name || "").trim());
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const confirm = req.body.confirm || "";

  const problem = passwordProblem(password, confirm);
  if (problem) {
    return showMessage(res, "🔒", "Please check your password", problem, "/signup", "Try Again");
  }

  // Only emails added by the teacher in charge can sign up
  if (!findApproved(email)) {
    return showMessage(res, "🚫", "Email not registered",
      "This email has not been added by the teacher in charge. Please ask them to add you.",
      "/signup", "Try Again");
  }

  const accounts = readJson(ACCOUNTS_FILE, []);
  let account = accounts.find(function (a) {
    return a.email === email;
  });

  if (account && account.verified) {
    return showMessage(res, "👤", "Account already exists",
      "You already have an account. Please sign in, or use \"Forgot password\".",
      "/", "Go to Sign In");
  }

  // New account (or a sign-up that was never confirmed: start it again)
  if (!account) {
    account = { email: email };
    accounts.push(account);
  }

  account.name = name;
  account.verified = false;
  setPassword(account, password);
  const code = giveLinkCode(account, "verify", 24 * 60);
  writeJson(ACCOUNTS_FILE, accounts);

  sendEmail(email, "Confirm your Assessment Portal account",
    "Hello " + name + ",\n\n" +
    "Please click this link to confirm your email and switch on your account:\n" +
    APP_URL + "/verify?code=" + code + "\n\n" +
    "The link works for 24 hours. If you did not sign up, you can ignore this email.");

  showMessage(res, "📧", "Check your email",
    "We sent a confirmation link to " + safe(email) + ". Click it to switch on your account, then sign in.",
    "/", "Go to Sign In");
});

// The link from the confirmation email
app.get("/verify", function (req, res) {
  const accounts = readJson(ACCOUNTS_FILE, []);
  const account = findByLinkCode(accounts, "verify", req.query.code);

  if (!account) {
    return showMessage(res, "⌛", "Link not valid",
      "This link has expired or was already used. Sign up again with the same email to get a new one.",
      "/signup", "Sign Up Again");
  }

  account.verified = true;
  clearLinkCode(account);
  writeJson(ACCOUNTS_FILE, accounts);

  showMessage(res, "🎉", "Email confirmed!",
    "Welcome, " + account.name + ". Your account is ready. You can now sign in.",
    "/", "Go to Sign In");
});


// =====================================================
// SIGN IN (every time after)
// =====================================================
app.post("/signin", function (req, res) {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  // Trying to sign in always signs out whoever was signed in before,
  // so a failed attempt can't send you back into the old account
  delete req.session.teacher;

  const account = readJson(ACCOUNTS_FILE, []).find(function (a) {
    return a.email === email;
  });

  // The role is always read from the approved list,
  // so removing someone from teachers.json locks them out.
  const approved = findApproved(email);

  if (!account || !approved || !passwordMatches(password, account)) {
    return showMessage(res, "😕", "Wrong email or password",
      "Please check your details and try again. New here? Create an account first.",
      "/", "Try Again");
  }

  if (!account.verified) {
    return showMessage(res, "📧", "Please confirm your email first",
      "Click the link we emailed you when you signed up. Can't find it? Sign up again with the same email to get a new link.",
      "/", "Back to Sign In");
  }

  // Start a fresh session for the new account
  req.session.regenerate(function () {
    req.session.teacher = {
      name: account.name,
      email: account.email,
      role: approved.role
    };

    req.session.save(function () {
      res.redirect(homeFor(req.session.teacher));
    });
  });
});

app.get("/logout", function (req, res) {
  req.session.destroy(function () {
    res.redirect("/");
  });
});


// =====================================================
// FORGOT PASSWORD
// =====================================================
app.post("/forgot", function (req, res) {
  const email = (req.body.email || "").trim().toLowerCase();
  const accounts = readJson(ACCOUNTS_FILE, []);
  const account = accounts.find(function (a) {
    return a.email === email;
  });

  if (account && findApproved(email)) {
    const code = giveLinkCode(account, "reset", 30);
    writeJson(ACCOUNTS_FILE, accounts);

    sendEmail(email, "Reset your Assessment Portal password",
      "Hello " + account.name + ",\n\n" +
      "Click this link to choose a new password:\n" +
      APP_URL + "/reset?code=" + code + "\n\n" +
      "The link works for 30 minutes. If you did not ask for this, ignore this email.");
  }

  // Same answer either way, so strangers can't test which emails have accounts
  showMessage(res, "📧", "Check your email",
    "If an account exists for that email, we have sent a link to reset your password. The link works for 30 minutes.",
    "/", "Back to Sign In");
});

// The link from the reset email: show the "new password" form
app.get("/reset", function (req, res) {
  const accounts = readJson(ACCOUNTS_FILE, []);
  const account = findByLinkCode(accounts, "reset", req.query.code);

  if (!account) {
    return showMessage(res, "⌛", "Link not valid",
      "This reset link has expired or was already used. Please ask for a new one.",
      "/forgot", "Send a New Link");
  }

  // The code is only letters and numbers (checked above), so it is safe to put in the page
  const page = fs.readFileSync(__dirname + "/reset.html", "utf8")
    .replaceAll("{{CODE}}", req.query.code);
  res.send(page);
});

app.post("/reset", function (req, res) {
  const code = req.body.code || "";
  const password = req.body.password || "";
  const confirm = req.body.confirm || "";

  const accounts = readJson(ACCOUNTS_FILE, []);
  const account = findByLinkCode(accounts, "reset", code);

  if (!account) {
    return showMessage(res, "⌛", "Link not valid",
      "This reset link has expired or was already used. Please ask for a new one.",
      "/forgot", "Send a New Link");
  }

  const problem = passwordProblem(password, confirm);
  if (problem) {
    return showMessage(res, "🔒", "Please check your password", problem,
      "/reset?code=" + code, "Try Again");
  }

  setPassword(account, password);
  account.verified = true; // they opened a link from their email, so it's theirs
  clearLinkCode(account);
  writeJson(ACCOUNTS_FILE, accounts);

  showMessage(res, "✅", "Password changed",
    "Your new password is saved. You can now sign in with it.",
    "/", "Go to Sign In");
});


// =====================================================
// ONE-TIME CODES FROM THE TEACHER IN CHARGE
// For teachers who can't get emails. The head makes a code and gives it
// to the teacher in person. The teacher uses it to set a new password.
// =====================================================

// Easy-to-read code like "K7QM-4XPA" (no 0/O or 1/I to mix up)
function makeTeacherCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += letters[crypto.randomInt(letters.length)];
  }
  return code.slice(0, 4) + "-" + code.slice(4);
}

// "k7qm 4xpa" -> "K7QM4XPA" so small typing differences don't matter
function tidyCode(text) {
  return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// The teacher in charge sees every approved teacher and their account status
app.get("/api/teachers", headOnly, function (req, res) {
  const accounts = readJson(ACCOUNTS_FILE, []);

  const list = readJson(TEACHERS_FILE, []).map(function (t) {
    const account = accounts.find(function (a) {
      return a.email === t.email.toLowerCase();
    });

    let status = "No account yet";
    let statusKey = "none";
    if (account && account.verified) {
      status = "Active";
      statusKey = "active";
    } else if (account) {
      status = "Waiting for email confirmation";
      statusKey = "waiting";
    }

    return {
      name: account ? account.name : "",
      email: t.email,
      role: t.role === "head" ? "Teacher in charge" : t.role,
      status: status,
      statusKey: statusKey
    };
  });

  res.json(list);
});

// The teacher in charge makes a code for one teacher
app.post("/api/teachers/code", headOnly, function (req, res) {
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!findApproved(email)) {
    return res.status(400).json({ error: "That email is not on the approved list." });
  }

  const code = makeTeacherCode();
  const codes = readJson(CODES_FILE, {});

  // a new code replaces any older one for this teacher
  codes[email] = {
    hash: sha256(tidyCode(code)),
    expires: Date.now() + 24 * 60 * 60 * 1000,
    tries: 0
  };
  writeJson(CODES_FILE, codes);

  res.json({ code: code });
});

// The teacher types the code and a new password
app.post("/code", function (req, res) {
  const email = (req.body.email || "").trim().toLowerCase();
  const name = safe((req.body.name || "").trim());
  const password = req.body.password || "";
  const confirm = req.body.confirm || "";

  const codes = readJson(CODES_FILE, {});
  const saved = codes[email];

  const notValid = function () {
    showMessage(res, "⌛", "Code not valid",
      "Check the email and code and try again. If it still fails, ask the teacher in charge for a new code.",
      "/code", "Try Again");
  };

  if (!findApproved(email) || !saved || saved.expires < Date.now()) {
    return notValid();
  }

  if (sha256(tidyCode(req.body.code)) !== saved.hash) {
    // 5 wrong tries and the code stops working, so it can't be guessed
    saved.tries = (saved.tries || 0) + 1;
    if (saved.tries >= 5) {
      delete codes[email];
    }
    writeJson(CODES_FILE, codes);
    return notValid();
  }

  const problem = passwordProblem(password, confirm);
  if (problem) {
    return showMessage(res, "🔒", "Please check your password", problem, "/code", "Try Again");
  }

  const accounts = readJson(ACCOUNTS_FILE, []);
  let account = accounts.find(function (a) {
    return a.email === email;
  });

  // No account yet? The code creates one, so a name is needed.
  if (!account) {
    if (name === "") {
      return showMessage(res, "👤", "Please type your full name",
        "You don't have an account yet, so we need your name to create one.",
        "/code", "Try Again");
    }
    account = { email: email };
    accounts.push(account);
  }

  if (name !== "") {
    account.name = name;
  }
  setPassword(account, password);
  account.verified = true; // the teacher in charge vouched for them
  clearLinkCode(account);
  writeJson(ACCOUNTS_FILE, accounts);

  // the code works only once
  delete codes[email];
  writeJson(CODES_FILE, codes);

  showMessage(res, "✅", "Password saved",
    "Your account is ready. You can now sign in with your email and new password.",
    "/", "Go to Sign In");
});


// =====================================================
// SCORES API
// Saved like this:  { "JHS 1A": { "Mathematics": [ {name, score}, ... ] } }
// =====================================================
function cleanClassName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 40);
}

// "jhs 1a" and "JHS 1A" are the same class
function findClassKey(allScores, name) {
  const existing = Object.keys(allScores).find(function (key) {
    return key.toLowerCase() === name.toLowerCase();
  });
  return existing || name;
}

// Tells the page who is signed in
app.get("/api/me", signedIn, function (req, res) {
  res.json(req.session.teacher);
});

// Names of all classes (everyone may see the class names)
app.get("/api/classes", signedIn, function (req, res) {
  res.json(Object.keys(readJson(SCORES_FILE, {})));
});

// Scores for one class.
// Teacher in charge gets every subject; a subject teacher only gets their own.
app.get("/api/scores", signedIn, function (req, res) {
  const allScores = readJson(SCORES_FILE, {});
  const className = findClassKey(allScores, cleanClassName(req.query.class));
  const classScores = allScores[className] || {};
  const teacher = req.session.teacher;

  if (teacher.role === "head") {
    return res.json(classScores);
  }

  const mine = {};
  if (classScores[teacher.role]) {
    mine[teacher.role] = classScores[teacher.role];
  }
  res.json(mine);
});

// A subject teacher sends one class's scores — always saved under THEIR OWN subject
app.post("/api/scores", subjectOnly, function (req, res) {
  const teacher = req.session.teacher;
  const subject = teacher.role;
  const name = cleanClassName(req.body.className);
  const students = req.body.students;

  if (name === "" || !Array.isArray(students)) {
    return res.status(400).json({ error: "Missing class name or students" });
  }

  // Keep only proper entries: a name and a score from 0 to 100
  const list = students
    .filter(function (s) {
      return s && typeof s.name === "string" && s.name.trim() !== "" &&
        typeof s.score === "number" && s.score >= 0 && s.score <= 100;
    })
    .map(function (s) {
      return { name: s.name.trim().slice(0, 80), score: s.score };
    });

  const allScores = readJson(SCORES_FILE, {});
  const className = findClassKey(allScores, name);

  if (!allScores[className]) {
    allScores[className] = {};
  }
  allScores[className][subject] = list;
  writeJson(SCORES_FILE, allScores);

  // Let the teacher(s) in charge know by email
  readJson(TEACHERS_FILE, [])
    .filter(function (t) {
      return t.role === "head";
    })
    .forEach(function (head) {
      sendEmail(head.email, subject + " scores received for " + className,
        teacher.name + " has sent " + list.length + " " + subject + " scores for " + className + ".\n\n" +
        "Sign in to see the class results: " + APP_URL);
    });

  res.json({ ok: true, className: className });
});

// Only the teacher in charge can delete a class's scores
app.delete("/api/scores", headOnly, function (req, res) {
  const allScores = readJson(SCORES_FILE, {});
  const className = findClassKey(allScores, cleanClassName(req.query.class));

  delete allScores[className];
  writeJson(SCORES_FILE, allScores);

  // NEW: also remove that class's attendance and remarks
  const reports = readJson(REPORTS_FILE, {});
  delete reports[className];
  writeJson(REPORTS_FILE, reports);

  res.json({ ok: true });
});


// =====================================================
// NEW: REPORT CARD EXTRAS (teacher in charge only)
// Attendance and remarks for each student's report card.
// Saved like this:
// { "JHS 1A": { term, year, totalDays, nextTerm,
//               students: { "kofi mensah": { present, conduct, interest, remark } } } }
// =====================================================

// "Kofi  Mensah" and "kofi mensah" are the same student
function studentKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function shortText(value, max) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, max);
}

// A whole number of days from 0 to 1000, or undefined if left empty / not valid
function dayCount(value) {
  if (value === "" || value === undefined || value === null) {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    return undefined;
  }
  return n;
}

// Attendance and remarks for one class
app.get("/api/reports", headOnly, function (req, res) {
  const allScores = readJson(SCORES_FILE, {});
  const className = findClassKey(allScores, cleanClassName(req.query.class));
  const reports = readJson(REPORTS_FILE, {});

  res.json(reports[className] || { students: {} });
});

// Save the class details plus one student's attendance and remarks
app.post("/api/reports", headOnly, function (req, res) {
  const allScores = readJson(SCORES_FILE, {});
  const className = findClassKey(allScores, cleanClassName(req.body.className));
  const student = req.body.student || {};
  const key = studentKey(student.name);

  if (!allScores[className]) {
    return res.status(400).json({ error: "That class has no scores yet." });
  }
  if (key === "") {
    return res.status(400).json({ error: "Missing student name." });
  }

  const totalDays = dayCount(req.body.totalDays);
  const present = dayCount(student.present);

  if (totalDays !== undefined && present !== undefined && present > totalDays) {
    return res.status(400).json({ error: "Days present can't be more than the total school days." });
  }

  const reports = readJson(REPORTS_FILE, {});
  const report = reports[className] || { students: {} };
  report.students = report.students || {};

  // details for the whole class
  report.term = shortText(req.body.term, 40);
  report.year = shortText(req.body.year, 20);
  report.nextTerm = shortText(req.body.nextTerm, 40);
  if (totalDays === undefined) {
    delete report.totalDays;
  } else {
    report.totalDays = totalDays;
  }

  // details for this student only
  const mine = {
    conduct: shortText(student.conduct, 60),
    interest: shortText(student.interest, 60),
    remark: shortText(student.remark, 300)
  };
  if (present !== undefined) {
    mine.present = present;
  }
  report.students[key] = mine;

  reports[className] = report;
  writeJson(REPORTS_FILE, reports);

  res.json({ ok: true, report: report });
});


app.listen(process.env.PORT || 3000, function () {
  console.log("Server is running on " + APP_URL);
  checkEmailSettings();
});
