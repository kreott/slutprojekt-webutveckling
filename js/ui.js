// buttons
const btnRun   = document.getElementById("btn-run");
const btnStep  = document.getElementById("btn-step");
const btnReset = document.getElementById("btn-reset");

// code editor
const editor = CodeMirror.fromTextArea(document.getElementById("code-input"), {
    lineNumbers: true,
    mode: "asm",
    theme: "custom",
    indentWithTabs: false,
    tabSize: 4,
    autoCloseBrackets: true,
});

// default program
editor.setValue(
`section .data
%define fifty 50


section .text
mov ecx, 10
mov eax, fifty

.loop:
    add ebx, eax
    add eax, ebx

    print ecx
    dec ecx

    cmp ecx, 0
    jne .loop`
);

// speed slider
const speedSlider = document.getElementById("speed-slider");
const speedSpan   = document.getElementById("speed-display");

speedSlider.value = 0; // setting here because html default wasnt sticking
speedSpan.textContent = "off";

speedSlider.addEventListener("input", () => {
    speedSpan.textContent = speedSlider.value == "0"
        ? "off"
        : (speedSlider.value / 1000).toFixed(1) + "s";
});

let isRunning = false;

// resets registers, flags, highlights, and the log
function reset() {
    for (const reg of ["EAX", "EBX", "ECX", "EDX", "EBP", "ESI", "EDI", "EIP"]) {
        cpu.regs[reg] = 0;
    }
    cpu.regs.ESP = 1024 * 1024; // stack starts at top of memory

    cpu.flags.ZERO     = false;
    cpu.flags.CARRY    = false;
    cpu.flags.SIGN     = false;
    cpu.flags.OVERFLOW = false;

    // remove the highlighted line from the editor if there is one
    if (highlightedLine !== null) {
        editor.removeLineClass(highlightedLine, "background", "current-line");
        highlightedLine = null;
    }

    lines = [];
    updateUIRegisters();
    updateUIFlags();

    document.getElementById("log-output").innerHTML = "";
}

btnRun.addEventListener("click", () => {
    // if already running, just stop and reset
    if (isRunning) {
        reset();
        isRunning = false;
        return;
    }

    reset();

    // check for errors before doing anything
    const errors = validate(editor.getValue());
    if (errors.length > 0) {
        for (const err of errors) log(err, true);
        return;
    }

    isRunning = true;
    loadProgram(editor.getValue());

    if (speedSlider.value == "0") {
        // run everything at once with no delay
        while (cpu.regs.EIP < lines.length) step();
        isRunning = false;
    } else {
        run(speedSlider.value);
    }
});

btnStep.addEventListener("click", () => {
    if (isRunning) return;

    // load the program on the first step
    if (cpu.regs.EIP === 0) {
        const errors = validate(editor.getValue());
        if (errors.length > 0) {
            for (const err of errors) log(err, true);
            return;
        }
        loadProgram(editor.getValue());
    }

    step();
});

btnReset.addEventListener("click", reset);

// registers shown in the main panel
const MAIN_REGISTER_NAMES = ["EAX", "EIP", "EBX", "ESP", "ECX", "EBP", "EDX", "ESI"];

function updateUIRegisters() {
    for (const reg of MAIN_REGISTER_NAMES) {
        const el = document.getElementById("reg-" + reg);
        if (el) el.querySelector(".reg-value").textContent = cpu.regs[reg];
    }

    // if the popup is open, keep it in sync too
    const popup = document.getElementById("reg-popup");
    if (popup && popup.style.display !== "none") renderRegisterPopup();
}

function updateUIFlags() {
    for (const flag of Object.keys(cpu.flags)) {
        const el = document.getElementById("flag-" + flag);
        if (el) el.querySelector(".flag-value").textContent = cpu.flags[flag];
    }
}

// highlights the current line in the editor based on EIP
let highlightedLine = null;
function highlightLine(eip) {
    // remove the old highlight first
    if (highlightedLine !== null) {
        editor.removeLineClass(highlightedLine, "background", "current-line");
    }

    // lineMap translates EIP (instruction index) to the real source line number
    const srcLine = lineMap[eip];
    if (srcLine === undefined) return;

    editor.addLineClass(srcLine, "background", "current-line");
    highlightedLine = srcLine;
    editor.scrollIntoView({ line: srcLine, ch: 0 }, 100); // scroll editor to keep the line visible
}

// adds a line to the output log, pass true for isError to show it in red
function log(message, isError = false) {
    const entry = document.createElement("div");
    entry.textContent = message;
    if (isError) entry.classList.add("error");

    const logOutput = document.getElementById("log-output");
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight; // scroll to the bottom so new output is visible
}

// register popup groups, each entry is a family of related registers
const POPUP_GROUPS = [
    { label: "A",   regs: ["EAX", "AX", "AH", "AL"] },
    { label: "B",   regs: ["EBX", "BX", "BH", "BL"] },
    { label: "C",   regs: ["ECX", "CX", "CH", "CL"] },
    { label: "D",   regs: ["EDX", "DX", "DH", "DL"] },
    { label: "Ptr", regs: ["ESP", "EBP", "ESI", "EDI", "EIP"] },
];

// creates a single register span pair (name + value)
function makeRegSpan(name) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "reg-name";
    nameSpan.textContent = name + ":";

    const valSpan = document.createElement("span");
    valSpan.className = "reg-val";
    valSpan.textContent = cpu.regs[name];

    return [nameSpan, valSpan];
}

// rebuilds the popup content with current register values
function renderRegisterPopup() {
    const container = document.getElementById("reg-popup-body");
    if (!container) return;
    container.innerHTML = "";

    for (const group of POPUP_GROUPS) {
        const section = document.createElement("div");
        section.className = "reg-popup-group";

        // two registers per row
        for (let i = 0; i < group.regs.length; i += 2) {
            const row = document.createElement("div");
            row.className = "reg-popup-row";

            for (const span of makeRegSpan(group.regs[i])) row.appendChild(span);
            if (group.regs[i + 1]) {
                for (const span of makeRegSpan(group.regs[i + 1])) row.appendChild(span);
            }

            section.appendChild(row);
        }
        container.appendChild(section);
    }
}

function openRegisterPopup() {
    renderRegisterPopup();
    document.getElementById("reg-popup").style.display = "block";
}

function closeRegisterPopup() {
    document.getElementById("reg-popup").style.display = "none";
}

// makes an element draggable by clicking and dragging its handle
function makeDraggable(popup, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("mousedown", (event) => {
        dragging = true;
        // record where inside the popup the click happened
        // so it doesnt jump when you first click
        offsetX = event.clientX - popup.getBoundingClientRect().left;
        offsetY = event.clientY - popup.getBoundingClientRect().top;
    });

    document.addEventListener("mousemove", (event) => {
        if (!dragging) return;
        popup.style.left = (event.clientX - offsetX) + "px";
        popup.style.top  = (event.clientY - offsetY) + "px";
    });

    document.addEventListener("mouseup", () => { 
        dragging = false; 
    });
}

// make the buttons open and close the popup
document.getElementById("btn-show-regs").addEventListener("click", openRegisterPopup);
document.getElementById("btn-close-reg-popup").addEventListener("click", closeRegisterPopup);

// make the popup window draggable
makeDraggable(
    document.querySelector(".reg-popup-inner"),
    document.querySelector(".reg-popup-titlebar")
);