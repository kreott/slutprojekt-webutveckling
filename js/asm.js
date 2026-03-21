// i spent 30 minutes writing comments for this
function createRegisters() {
    // backing storage for the 4 general purpose register families (A, B, C, D)
    // Uint32Array forces every value to be a 32 bit unsigned integer
    // this means values automatically wrap around on overflow, just like real registers
    const backing = new Uint32Array(4);

    // maps each register family letter to its index in the backing array
    const INDEX = { A: 0, B: 1, C: 2, D: 3 };
    const regs = {};

    // backing storage for special registers that dont have sub-registers
    const special = new Uint32Array(5);
    const SPECIAL = { ESP: 0, EBP: 1, ESI: 2, EDI: 3, EIP: 4 };

    for (const [letter, i] of Object.entries(INDEX)) {

        // EAX is the full 32 bit register
        // getter just returns the raw value, no masking needed
        // setter uses >>> 0 to force the value into an unsigned 32 bit integer
        // without >>> 0 you could accidentally store a float or negative number

        // E_X registers
        Object.defineProperty(regs, `E${letter}X`, {
            get()    { return backing[i]; },
            set(val) { backing[i] = val >>> 0; }
        });

        // AX is the lower 16 bits of EAX
        // getter: & 0xFFFF masks out the upper 16 bits, keeping only bits 0-15
        // example: 0xDEADBEEF & 0x0000FFFF = 0x0000BEEF
        // setter: & 0xFFFF0000 keeps the upper 16 bits of backing intact
        // | (val & 0xFFFF) merges in the new lower 16 bits
        // example: upper: 0xDEAD0000 lower: 0x00001234 result: 0xDEAD1234

        // _X registers
        Object.defineProperty(regs, `${letter}X`, {
            get()    { return backing[i] & 0xFFFF; },
            set(val) { backing[i] = (backing[i] & 0xFFFF0000) | (val & 0xFFFF); }
        });

        // AH is bits 8 to 15 of EAX (the high byte of AX)
        // getter: & 0xFF00 isolates bits 8-15, >> 8 shifts them down to bits 0-7
        // example: 0xDEADBEEF & 0x0000FF00 = 0x0000BE00, >> 8 = 0x000000BE
        // setter: & 0xFFFF00FF zeroes out bits 8-15, preserving everything else
        // (val & 0xFF) << 8 shifts val up into bits 8-15
        // example: val=0x12: 0x12 << 8 = 0x1200, merged into backing at bits 8-15

        // _H registers
        Object.defineProperty(regs, `${letter}H`, {
            get()    { return (backing[i] & 0xFF00) >> 8; },
            set(val) { backing[i] = (backing[i] & 0xFFFF00FF) | ((val & 0xFF) << 8); }
        });

        // AL is the lowest 8 bits of EAX
        // getter: & 0xFF isolates bits 0-7, no shifting needed since its already at the bottom
        // 0xDEADBEEF & 0x000000FF = 0x000000EF
        // setter: & 0xFFFFFF00 zeroes out bits 0-7, preserving everything else
        // | (val & 0xFF) merges in the new low byte
        // e.g val=0x12: backing becomes 0xDEADBE12

        // _L registers
        Object.defineProperty(regs, `${letter}L`, {
            get()    { return backing[i] & 0xFF; },
            set(val) { backing[i] = (backing[i] & 0xFFFFFF00) | (val & 0xFF); }
        });
    }

    // special registers don't have sub-registers so they're simpler
    // just a straight 32 bit read/write with >>> 0 clamping on set

    // e.g. ESP, EIP (stack pointer and instruction pointer)
    for (const [name, i] of Object.entries(SPECIAL)) {
        Object.defineProperty(regs, name, {
            get()    { return special[i]; },
            set(val) { special[i] = val >>> 0; }
        });
    }

    // initialize stack pointer to the top of memory
    // the stack grows downward so ESP starts at the highest address
    regs.ESP = 1024 * 1024;

    return regs;
}

const cpu = {
    regs: createRegisters(),
    flags: {
        ZERO: false, // zero flag 
        CARRY: false, // carry flag
        SIGN: false, // sign flag
        OVERFLOW: false, // overflow flag (when a 32 bit integer overflows)
    }
};

const memory = new Uint8Array(1024 * 1024); // 1 megabyte

// stores the memory address of each .data variable by name
const dataMap = {};

// simple bump allocator for .data variables, starts after a safe offset
let heapPtr = 0x2000;

function allocate(size) {
    const addr = heapPtr;
    heapPtr += size;
    return addr;
}

function read8(addr) {
    return (memory[addr]);
}

function read16(addr) {
    return (memory[addr] << 8) |
           (memory[addr + 1]);
}

function read32(addr) {
    return (memory[addr] << 24) |
           (memory[addr + 1] << 16) |
           (memory[addr + 2] << 8) |
           (memory[addr + 3]); 
}

function write8(addr, val) {
    memory[addr] = val;
}

function write16(addr, val) {
    memory[addr] = (val >> 8) & 0xFF;
    memory[addr + 1] = val & 0xFF;
}

function write32(addr, val) {
    memory[addr] = (val >> 24) & 0xFF;
    memory[addr + 1] = (val >> 16) & 0xFF;
    memory[addr + 2] = (val >> 8) & 0xFF;
    memory[addr + 3] = val & 0xFF;
}

// strips out %define lines and replaces any names they 
// defined everywhere else in the code
function preprocess(code) {
    const defined = {};

    const lines = code.split("\n").map(line => {
        const trimmed = line.trim().toUpperCase();
        if (!trimmed.startsWith("%DEFINE")) return line;

        // grab the name and value from "%define NAME VALUE"
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
            defined[parts[1].toUpperCase()] = parts[2];
        }
        return ""; // blank the line instead of removing it
    });

    // swap out any defined names in the remaining lines
    return lines.map(line => {
        for (const [name, value] of Object.entries(defined)) {
            line = line.replace(new RegExp(`\\b${name}\\b`, "gi"), value);
        }
        return line;
    }).join("\n");
}
// parse assembly lines
let lines = [];
let labels = {};
function parseLine(line) {
    // pull out any quoted string before uppercasing
    let stringLiteral = null;
    line = line.replace(/"([^"]*)"/, (match, inner) => {
        stringLiteral = inner; // save the original casing
        return `"__STR__"`;    // replace with a placeholder
    });

    line = line.trim().toUpperCase();
    line = line.split(";")[0].trim(); // remove ; comments

    if (line === "") return null; // if line is empty return null


    const parts = line.split(" "); // parts of the line, operation, destination etc
    const op = parts[0]; // operation
    const args = parts.slice(1).join(" ").split(", ").map(a => a.trim()); // splits the arguments of the line into an array

    // put the real string back in place of the placeholder
    if (stringLiteral !== null) {
        const idx = args.findIndex(a => a === `"__STR__"`);
        if (idx !== -1) args[idx] = `"${stringLiteral}"`;
    }

    return { raw: line, op: op, args: args };
}

// parse labels
let lineMap = [];
function loadProgram(code) {
    code = preprocess(code);

    lines = [];
    labels = {};
    lineMap = [];

    let currentSection = "text";
    const textLines = [];
    const dataLines = [];

    const rawLines = code.split("\n");
    const parsed = [];

    rawLines.forEach((raw, srcLine) => {
        if (raw.trim().toLowerCase() === "section .data") {
            currentSection = "data";
        } else if (raw.trim().toLowerCase() === "section .text") {
            currentSection = "text";
        } else {
            // push to the right section array
            if (currentSection === "data") {
                dataLines.push({ raw, srcLine });
            } else {
                textLines.push({ raw, srcLine });
            }
        }
    });

    // parse each line but keep track of its original line number
    rawLines.forEach((raw, srcLine) => {
        const line = parseLine(raw);
        if (line) parsed.push({ ...line, srcLine });
    });

    // find labels
    let offset = 0;
    parsed.forEach((line, index) => {
        if (line.raw.endsWith(":")) {
            labels[line.raw.slice(0, -1)] = index - offset;
            offset++;
        }
    });

    // find labels and build lines and lineMap in one pass over parsed
    let instrIndex = 0;
    parsed.forEach(line => {
        if (line.raw.endsWith(":")) {
            // store where this label points in the instruction list
            labels[line.raw.slice(0, -1)] = instrIndex;
        } else if (line.op !== "SECTION") {
            lineMap.push(line.srcLine);
            lines.push(line);
            instrIndex++;
        }
    });

    // reset data memory so old variables dont hang around between runs
    heapPtr = 0x2000;
    Object.keys(dataMap).forEach(k => delete dataMap[k]);

    // process .data section lines — each one is "name dd value"
    dataLines.forEach(({ raw }) => {
        const parts = raw.trim().split(/\s+/);
        if (parts.length < 3) return;

        const name  = parts[0].toUpperCase();
        const type  = parts[1].toUpperCase();
        const value = Number(parts[2]);

        if (type === "DD") {
            const addr = allocate(4);
            write32(addr, value);
            dataMap[name] = addr;
        }
    });
}

// checks for errors in arguments
function isValidArg(str) {
    return cpu.regs[str] !== undefined || !isNaN(resolveVal(str));
}

// checks for errors and typos
function validate(code) {
    code = preprocess(code);

    const jumpOps = ["JMP", "JE", "JNE", "JG", "JGE", "JL", "JLE", "CALL"];
    const parsed = code.split("\n").map(parseLine).filter(line => line !== null);
    const stringOps = ["PRINT"];
    const errors = [];

    parsed.forEach((line, index) => {
        if (line.raw.endsWith(":")) return; // skip labels
        if (line.op === "SECTION") return;  // skip section headers
        if (stringOps.includes(line.op)) return; // strings would fail isValidArg

        // check instructions
        if (!instructions[line.op]) {
            errors.push(`line ${index + 1}: unknown instruction '${line.op}'`);
        }

        // skip checking arguments if instruction is a jump
        if (jumpOps.includes(line.op)) return;

        // check arguments
        line.args.forEach(arg => {
            if (!isValidArg(arg)) {
                errors.push(`line ${index + 1}: invalid argument '${arg}'`);
            }
        });
    });

    return errors;
}


// helpers //

// gets the value of a register, data variable, or plain number
// "EAX" -> cpu.regs.EAX, "MYVAR" -> read32(dataMap.MYVAR), "42" -> 42
function resolveVal(val) {
    if (cpu.regs[val] !== undefined) return cpu.regs[val];
    if (isMemRef(val)) return read32(resolveVal(val.slice(1, -1)));
    if (dataMap[val] !== undefined) return read32(dataMap[val]); // look up data variables
    if (val.startsWith("0X")) return parseInt(val, 16);
    return Number(val);
}

// checks if something is a memory reference like [EAX] or [100]
function isMemRef(arg) {
    return arg.startsWith("[") && arg.endsWith("]");
}

// handles writing to both registers and memory addresses
// if dst is something like [EAX] it writes to that address in memory
// otherwise just writes to the register directly
function writeDst(dst, val) {
    if (isMemRef(dst)) {
        write32(resolveVal(dst.slice(1, -1)), val);
    } else {
        cpu.regs[dst] = val;
    }
}

// updates cpu flags
function updateFlags(result, carry = false) {
    cpu.flags.ZERO = result === 0;
    cpu.flags.SIGN = result > 0x7FFFFFFF;
    cpu.flags.CARRY = carry;
    cpu.flags.OVERFLOW = false; // todo
}

// assembly instructions
const instructions = {
    // in here i will refer to args[0] as destination or dest and args[1] as source or src 

    // move / copy a value from src to dest
    MOV(args) { 
        writeDst(args[0], resolveVal(args[1]));
    },

    // add src to dest
    ADD(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a + b;

        updateFlags(result, result > 0xFFFFFFFF);
        writeDst(args[0], result);
    },

    // subtract src from dest
    SUB(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a - b;

        updateFlags(result, result < 0);
        writeDst(args[0], result);
    },

    // multiply dest by src
    MUL(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a * b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    DIV(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a / b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise AND &
    AND(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a & b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise OR |
    OR(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a | b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise XOR ^ (exclusive or)
    XOR(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a ^ b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise NOT ~
    NOT(args) {
        const result = ~resolveVal(args[0]);

        updateFlags(result);
        writeDst(args[0], result);
    },

    // increment dest by 1
    INC(args) {
        const result = resolveVal(args[0]) + 1;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // decrement dest by 1
    DEC(args) {
        const result = resolveVal(args[0]) - 1;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // compare dest and src
    CMP(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a - b;

        updateFlags(result);
    },

    // unconditional jump to a label
    JMP(args) {
        cpu.regs.EIP = labels[args[0]];
    },

    // jump if equal
    JE(args) {
        if (cpu.flags.ZERO) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    // jump if not equal
    JNE(args) {
        if (!cpu.flags.ZERO) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    // jump if greater
    JG(args) {
        if (!cpu.flags.ZERO && cpu.flags.SIGN === cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    // jump if greater or equal
    JGE(args) {
        if (cpu.flags.SIGN === cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    // jump if less
    JL(args) {
        if (!cpu.flags.ZERO && cpu.flags.SIGN !== cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    // jump if less or equal
    JLE(args) {
        if (cpu.flags.ZERO || cpu.flags.SIGN !== cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    // push to stack
    PUSH(args) {
        const val = resolveVal(args[0]);
        
        cpu.regs.ESP -= 4;
        write32(cpu.regs.ESP, val);
    },

    // pop from stack
    POP(args) {
        const dest = args[0];
        const val = read32(cpu.regs.ESP);

        cpu.regs.ESP += 4;
        writeDst(dest, val);
    },
    
    // call function
    CALL(args) {
        cpu.regs.ESP -= 4;
        write32(cpu.regs.ESP, cpu.regs.EIP + 1);
        cpu.regs.EIP = labels[args[0]];
    },

    // return from function
    RET() {
        cpu.regs.EIP = read32(cpu.regs.ESP);
        cpu.regs.ESP += 4;
    },

    // print string or value
    PRINT(args) {
        const val = args[0];
        if (val.startsWith('"') && val.endsWith('"')) {
            log(val.slice(1, -1)); // strip quotes and print
        } else {
            log(resolveVal(val));
        }
    },
};

// execute instruction
function execute(inst) {
    // highlight current line
    highlightLine(cpu.regs.EIP);

    const fn = instructions[inst.op];

    if (fn) {
        fn(inst.args);
    } else {
        // unknown instruction. error handling happens before the code runs,
        // so this is probably not necessary
    }
}

// execute one line
function step() {
    if (cpu.regs.EIP >= lines.length) {
        return;
    }

    const inst = lines[cpu.regs.EIP];
    const prevEIP = cpu.regs.EIP;

    execute(inst);

    if (cpu.regs.EIP === prevEIP) {
        cpu.regs.EIP++;
    }

    updateUIRegisters();
    updateUIFlags();
}

// run with a delay (or none)
function run(delay) {
    const timer = setInterval(() => {
        step();
        if (cpu.regs.EIP >= lines.length) {
            clearInterval(timer); // stop when program ends
            isRunning = false;
            btnRun.disabled = false;
        }
    }, delay);
}