import { createEmail } from './email/index.js';
import { createWhatsApp } from './whatsapp.js';

// A tracker is one thing being watched: a WhatsApp account or a mailbox. Each one follows the
// same small contract, so a new kind of tracker is one more file here:
//
//   createX(def, env) -> { start(), stop(), command(action) }
//
//   def  the tracker as written in the config ({ id, name, type, ... })
//   env  what the runtime gives it:
//     dir          its own folder for files (session, state)
//     opt          command line options
//     tty          true when a person is at the terminal
//     set(state, extra)   report its state ('listening', 'needs login', 'error', ...)
//     entry        its status record, shown in the interface
//     handle(item)        hand over an incoming message: { chat, text, key, title(rule), body, match(rule) }
//     log / warn / error  messages tagged with the tracker's name
const FACTORIES = { whatsapp: createWhatsApp, email: createEmail };

export const createTracker = (def, env) => FACTORIES[def.type](def, env);
