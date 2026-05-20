import { createClient } from '@supabase/supabase-js';
import type { JobPosting, Contact } from '../types.js';

// ============================================================================
// Local Row Interfaces
// ============================================================================

interface RawContactRow {
  id: string;
  name: string;
  title: string;
  linkedin_url?: string;
  role_type: string;
  connection_note?: string;
  messages?: Array<{ id: string; content: string; status: string }>;
}

export interface ContactRow {
  contactId: string;
  name: string;
  title: string;
  linkedinUrl?: string;
  roleType: string;
  connectionNote?: string;
  messageId?: string;
  messageContent?: string;
}

export interface JobListRow {
  id: string;
  url: string;
  company: string;
  title: string;
  status: string;
  created_at: string;
}

// ============================================================================
// Client
// ============================================================================

export function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');
  }

  return createClient(url, key);
}

// ============================================================================
// Job Postings
// ============================================================================

export async function getJobByUrl(url: string): Promise<JobPosting | null> {
  const { data, error } = await getClient().from('jobs').select('*').eq('url', url).maybeSingle();

  if (error) {
    throw new Error(`Supabase error fetching job: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    url: data.url,
    company: data.company,
    title: data.title,
    description: data.description,
    location: data.location,
    salaryRange: data.salary_range,
    requirements: data.requirements,
    coverLetter: data.cover_letter,
    status: data.status,
  };
}

export async function saveJob(job: Omit<JobPosting, 'id'>): Promise<string> {
  const { data, error } = await getClient().from('jobs').upsert({
    url: job.url,
    company: job.company,
    title: job.title,
    description: job.description,
    location: job.location ?? null,
    salary_range: job.salaryRange ?? null,
    requirements: job.requirements ?? null,
    cover_letter: job.coverLetter ?? null,
    status: job.status ?? 'pending',
  }, { onConflict: 'url' }).select('id').single();

  if (error) {
    throw new Error(`Supabase error saving job: ${error.message}`);
  }

  return data.id as string;
}

export async function listJobs(): Promise<JobListRow[]> {
  const { data, error } = await getClient().from('jobs').select('id, url, company, title, status, created_at').order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Supabase error listing jobs: ${error.message}`);
  }

  return data ?? [];
}

// ============================================================================
// Contacts
// ============================================================================

export async function saveContact(contact: Contact): Promise<string> {
  const { data, error } = await getClient().from('contacts').upsert({
    job_id: contact.jobId,
    name: contact.name,
    title: contact.title ?? null,
    linkedin_url: contact.linkedinUrl ?? null,
    company: contact.company,
    role_type: contact.roleType,
    outreach_message: contact.outreachMessage ?? null,
    connection_note: contact.connectionNote ?? null,
  }, { onConflict: 'job_id,name' }).select('id').single();

  if (error) {
    throw new Error(`Supabase error saving contact: ${error.message}`);
  }

  return data.id as string;
}

export async function getContactsForJob(jobId: string): Promise<ContactRow[]> {
  const { data, error } = await getClient().from('contacts').select('id, name, title, linkedin_url, role_type, connection_note, messages(id, content, status)').eq('job_id', jobId);

  if (error) {
    throw new Error(`Supabase error fetching contacts: ${error.message}`);
  }

  return (data ?? []).map((c: RawContactRow) => {
    const draft = c.messages?.find(m => m.status === 'draft');

    return {
      contactId: c.id,
      name: c.name,
      title: c.title,
      linkedinUrl: c.linkedin_url ?? undefined,
      roleType: c.role_type,
      connectionNote: c.connection_note ?? undefined,
      messageId: draft?.id,
      messageContent: draft?.content,
    };
  });
}

export async function updateConnectionNote(contactId: string, note: string): Promise<void> {
  const { error } = await getClient().from('contacts').update({ connection_note: note }).eq('id', contactId);

  if (error) {
    throw new Error(`Supabase error updating connection note: ${error.message}`);
  }
}

// ============================================================================
// Messages
// ============================================================================

export async function saveMessage(contactId: string, jobId: string, content: string, platform = 'linkedin'): Promise<string> {
  const { data, error } = await getClient().from('messages').insert({ contact_id: contactId, job_id: jobId, platform, content, status: 'draft' }).select('id').single();

  if (error) {
    throw new Error(`Supabase error saving message: ${error.message}`);
  }

  return data.id as string;
}

export async function markMessageSent(messageId: string): Promise<void> {
  const { error } = await getClient().from('messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', messageId);

  if (error) {
    throw new Error(`Supabase error marking message sent: ${error.message}`);
  }
}
