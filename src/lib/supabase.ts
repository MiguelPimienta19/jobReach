import { createClient } from '@supabase/supabase-js';
import type { JobPosting, Contact } from '../types.js';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  return createClient(url, key);
}

export async function getJobByUrl(url: string): Promise<JobPosting | null> {
  const { data } = await getClient().from('jobs').select('*').eq('url', url).maybeSingle();
  if (!data) return null;
  return { id: data.id, url: data.url, company: data.company, title: data.title, description: data.description, location: data.location, salaryRange: data.salary_range, requirements: data.requirements, coverLetter: data.cover_letter, status: data.status };
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
  if (error) throw new Error(`Supabase error saving job: ${error.message}`);
  return data.id as string;
}

export async function saveContact(contact: Contact): Promise<string> {
  const { data, error } = await getClient().from('contacts').upsert({
    job_id: contact.jobId,
    name: contact.name,
    title: contact.title ?? null,
    linkedin_url: contact.linkedinUrl ?? null,
    company: contact.company,
    role_type: contact.roleType,
    outreach_message: contact.outreachMessage ?? null,
  }, { onConflict: 'job_id,name' }).select('id').single();
  if (error) throw new Error(`Supabase error saving contact: ${error.message}`);
  return data.id as string;
}

export async function saveMessage(contactId: string, jobId: string, content: string, platform = 'linkedin'): Promise<void> {
  const { error } = await getClient().from('messages').insert({ contact_id: contactId, job_id: jobId, platform, content, status: 'draft' });
  if (error) throw new Error(`Supabase error saving message: ${error.message}`);
}
