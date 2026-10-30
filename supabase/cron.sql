-- Hourly auto-close: Confirmed bookings whose end time has passed -> Completed.
-- First enable pg_cron: Dashboard -> Database -> Extensions -> pg_cron.
-- Then run this once in the SQL Editor.

select cron.unschedule(jobid) from cron.job where jobname = 'ztn-close-completed';

select cron.schedule(
  'ztn-close-completed',
  '5 * * * *',                       -- five past every hour
  $$ select public._close_completed() $$
);
