import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="hsec"><h2>{title}</h2>{children}</section>
);

// term, what it does, and an optional example
type Row = [term: string, what: string, example?: string];
const Rows = ({ rows }: { rows: Row[] }) => (
  <div className="card kv">
    {rows.map(([term, what, example]) => (
      <div key={term} className="kvrow">
        <b>{term}</b>
        <span>{what}</span>
        {example && <code>{example}</code>}
      </div>
    ))}
  </div>
);

const Step = ({ icon, title, text }: { icon: IconName; title: string; text: string }) => (
  <div className="card hstep"><span className="lead"><Icon name={icon} size={20} /></span><b>{title}</b><span>{text}</span></div>
);

const Recipe = ({ title, steps }: { title: string; steps: string[] }) => (
  <div className="card recipe"><b>{title}</b><ul>{steps.map((s) => <li key={s}>{s}</li>)}</ul></div>
);

export function Help() {
  return (
    <div className="help">
      <div className="hsteps">
        <Step icon="radar" title="Add a tracker" text="A WhatsApp or email account to watch." />
        <Step icon="rules" title="Write a rule" text="Which words, senders and chats count." />
        <Step icon="send" title="Choose delivery" text="This computer, your devices, or both." />
      </div>

      <Section title="Matching words">
        <Rows rows={[
          ['Whole word', 'The word on its own', '“bike” finds “a bike”, not “motorbike”'],
          ['Part of a word', 'The text anywhere', '“book” finds “notebook”'],
          ['Phrase', 'Spaces and line breaks are ignored', '“for sale”'],
          ['Regex', 'A regular expression', 'rs\\.?\\s*\\d+'],
        ]} />
        <p className="note">Capital letters never matter. Rules apply instantly, no restart.</p>
      </Section>

      <Section title="Combining">
        <Rows rows={[
          ['Any of', 'One match is enough (or)'],
          ['Also require', 'Every box needs a match (and)'],
          ['Ignore', 'Any match skips the message'],
          ['Empty', 'Alerts on every message from the chosen chats or senders'],
        ]} />
      </Section>

      <Section title="Chats and senders">
        <Rows rows={[
          ['All', 'Every chat, or every sender'],
          ['Only these', 'The ones you add'],
          ['All except', 'Everything but the ones you add'],
          ['WhatsApp chat', 'Exact name, part of a name, phone number, or chat ID (survives renames)'],
          ['Email sender', 'Name or address; “@company.com” covers a whole company'],
        ]} />
      </Section>

      <Section title="Email filters">
        <Rows rows={[
          ['Recipient', 'Sent to a given address, such as an alias'],
          ['Subject', 'Words in the subject only'],
          ['Attachment', 'Has one, none, or a type or name', 'pdf, xlsx, contains:invoice'],
          ['Size', 'Larger or smaller than', '500KB, 2MB'],
          ['Not a newsletter', 'Skips mailing lists and auto-replies'],
          ['Verified sender', 'SPF, DKIM or DMARC passed'],
          ['Important', 'Flagged high priority by the sender'],
          ['Hours', 'Only on chosen days and times'],
        ]} />
        <p className="note">Email is only read: nothing is marked read, moved, deleted or sent. Passwords stay in your keychain. Gmail, Outlook, Yahoo and iCloud need an app password.</p>
      </Section>

      <Section title="Examples">
        <div className="recipes">
          <Recipe title="Sales, not buyers" steps={['Chats: the trading groups', 'Also require: sell, for sale', 'Ignore: buy, wtb, wanted']} />
          <Recipe title="Invoices with a PDF" steps={['Listen on: your email', 'Any of: invoice', 'Attachment: pdf']} />
          <Recipe title="Mail from your boss" steps={['Listen on: your email', 'From: @company.com', 'Priority: High']} />
          <Recipe title="Work hours only" steps={['Hours: Mon to Fri', '09:00 to 18:00']} />
          <Recipe title="Everything but one group" steps={['Chats: All except, add the noisy one', 'Any of: your words']} />
          <Recipe title="A price" steps={['Any of, as Regex: rs\\.?\\s*\\d+']} />
        </div>
      </Section>

      <Section title="Good to know">
        <Rows rows={[
          ['Priority', 'Silent to Urgent sets how strongly a device buzzes'],
          ['Repeats', 'Settings → Ignore repeats alerts once per sender and text'],
          ['History', 'Every match is listed under Notifications'],
          ['Command line', 'whatsgrep help'],
        ]} />
      </Section>
    </div>
  );
}
