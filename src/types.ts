export type JobStatus = 'pending' | 'applied' | 'interview' | 'offer' | 'rejected';
export type RoleType = 'recruiter' | 'hiring_manager' | 'new_grad_hire' | 'other';

export interface JobPosting {
  id?: string;
  url: string;
  company: string;
  title: string;
  description: string;
  location?: string;
  salaryRange?: string;
  requirements?: string;
  coverLetter?: string;
  status?: JobStatus;
}

export interface Contact {
  id?: string;
  jobId?: string;
  name: string;
  title: string;
  linkedinUrl?: string;
  company: string;
  roleType: RoleType;
  outreachMessage?: string;
}

export interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

export interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
}
