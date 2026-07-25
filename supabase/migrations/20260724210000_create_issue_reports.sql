-- Create issue_reports table for Bug Report and Feedback system
CREATE TABLE IF NOT EXISTS public.issue_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id UUID, -- Nullable for anonymous/unauthenticated users
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    url TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'pending' NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,

    -- Safety Check Constraints
    CONSTRAINT check_category CHECK (category IN ('bug', 'ui', 'data', 'other')),
    CONSTRAINT check_description_length CHECK (char_length(description) >= 1 AND char_length(description) <= 500),
    CONSTRAINT check_status CHECK (status IN ('pending', 'processing', 'resolved', 'ignored'))
);

-- Add comments for documentation
COMMENT ON TABLE public.issue_reports IS 'Saves bug reports and suggestions submitted by users.';
COMMENT ON COLUMN public.issue_reports.category IS 'Category of report: bug, ui, data, or other';
COMMENT ON COLUMN public.issue_reports.description IS 'Detailed issue description, length must be between 1 and 500 characters';
COMMENT ON COLUMN public.issue_reports.status IS 'Current status of report: pending, processing, resolved, or ignored';

-- Create triggers to auto update updated_at
CREATE OR REPLACE FUNCTION public.handle_issue_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_issue_reports_updated_at ON public.issue_reports;

CREATE TRIGGER trigger_update_issue_reports_updated_at
    BEFORE UPDATE ON public.issue_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_issue_reports_updated_at();

-- Set up Row Level Security (RLS) policies
ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (if the user is offline/anonymous or we want to allow guests to report bugs)
CREATE POLICY "Allow anonymous and authenticated inserts" 
    ON public.issue_reports 
    FOR INSERT 
    WITH CHECK (true);

-- Allow only administrators to view all reports
CREATE POLICY "Only admins can select reports" 
    ON public.issue_reports 
    FOR SELECT 
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- Allow only administrators to delete reports
CREATE POLICY "Only admins can delete reports" 
    ON public.issue_reports 
    FOR DELETE 
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );
