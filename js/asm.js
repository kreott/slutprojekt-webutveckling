// i spend 30 minutes writing comments for this
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

function read32(addr) {
    return (memory[addr] << 24) |
           (memory[addr + 1] << 16) |
           (memory[addr + 2] << 8) |
           (memory[addr + 3]); 
}

function read16(addr) {
    return (memory[addr] << 8) |
           (memory[addr + 1]);
}

function read8(addr) {
    return (memory[addr]);
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

// parse assembly lines
let lines = [];
let labels = {};
function parseLine(line) {
    line = line.trim().toUpperCase();
    line = line.split(";")[0].trim(); // remove ; comments

    if (line === "") return null; // if line is empty return null

    const parts = line.split(" "); // parts of the line, operation, destination etc
    const op = parts[0]; // operation
    const args = parts.slice(1).join(" ").split(", ").map(a => a.trim()); // splits the arguments of the line into an array
    return { raw: line, op: op, args: args };
}

// parse labels
function loadProgram(code) {
    // parse all lines, strip blanks and comments
    const parsed = code.split("\n").map(parseLine).filter(line => line !== null);

    lines = [];
    labels = {};
    let offset = 0;

    // find all labels and map them to their line index
    parsed.forEach((line, index) => {
        if (line.raw.endsWith(":")) {
            labels[line.raw.slice(0, -1)] = index - offset;
            offset++;
        }
    });

    // remove label lines from the code
    lines = parsed.filter(line => !line.raw.endsWith(":"));
}

function validate(code) {
    const parsed = code.split("\n").map(parseLine).filter(line => line !== null);
    const errors = [];

    parsed.forEach((line, index) => {
        if (line.raw.endsWith(":")) return; // skip labels

        if (!instructions[line.op]) {
            errors.push(`line ${index + 1}: unknown instruction "${line.op}"`);
        }
    });

    return errors;
}


// helpers //

// gets the value of a register or a plain number
// "EAX" -> cpu.regs.EAX, "42" -> 42
function resolveVal(val) {
    if (cpu.regs[val] !== undefined) {
        return cpu.regs[val];
    }
    if (isMemRef(val)) {
        return read32(resolveVal(derefMem(val)));
    }
    if (val.startsWith("0X")) {
        return parseInt(val, 16);
    }
    return Number(val);
}

// checks if something is a memory reference like [EAX] or [100]
function isMemRef(arg) {
    return arg.startsWith("[") && arg.endsWith("]");
}

// strips the brackets off a memory reference, [EAX] -> EAX
function derefMem(arg) {
    return arg.slice(1, -1);
}

// handles writing to both registers and memory addresses
// if dst is something like [EAX] it writes to that address in memory
// otherwise just writes to the register directly
function writeDst(dst, val) {
    console.log("writeDst:", dst, val);
    if (isMemRef(dst)) {
        write32(resolveVal(derefMem(dst)), val);
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
        writeDst(args[0], result)
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

    JG(args) {
        if (!cpu.flags.ZERO && cpu.flags.SIGN === cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    JGE(args) {
        if (cpu.flags.SIGN === cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    JL(args) {
        if (!cpu.flags.ZERO && cpu.flags.SIGN !== cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    JLE(args) {
        if (cpu.flags.ZERO || cpu.flags.SIGN !== cpu.flags.OVERFLOW) {
            cpu.regs.EIP = labels[args[0]];
        }
    },

    PUSH(args) {
        const val = resolveVal(args[0]);
        
        cpu.regs.ESP -= 4;
        write32(cpu.regs.ESP, val);
    },

    POP(args) {
        const dest = args[0];
        const val = read32(cpu.regs.ESP);

        cpu.regs.ESP += 4;
        writeDst(dest, val);
    },
    
    CALL(args) {
        cpu.regs.ESP -= 4;
        write32(cpu.regs.ESP, cpu.regs.EIP + 1);
        cpu.regs.EIP = labels[args[0]]
    },

    RET() {
        cpu.regs.EIP = read32(cpu.regs.ESP);
        cpu.regs.ESP += 4;
    }
};

function execute(inst) {
    const fn = instructions[inst.op];

    if (fn) {
        fn(inst.args);
    } else {
        // unknown instruction. Todo: add errors
    }
}

function step() {
    // bounds check, checks if we're at the end of the code
    if (cpu.regs.EIP >= lines.length) {
        return;
    }

    const inst = lines[cpu.regs.EIP];
    const prevEIP = cpu.regs.EIP;

    // log to output
    log(inst.raw);

    // execute current instruction
    execute(inst);
    
    // only increment EIP if a jump hasnt occurred
    if (cpu.regs.EIP === prevEIP) {
        cpu.regs.EIP++;
    }

    // update UI
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