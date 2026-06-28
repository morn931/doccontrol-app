-- Add developer role to users.role check constraint
-- and assign it to Morné Cronjé and Liezl Cronjé.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'admin', 'document_controller', 'reviewer',
    'engineering_manager', 'project_manager', 'vendor',
    'developer'
  ));

UPDATE users
SET role = 'developer'
WHERE email IN ('mornec@ppetech.co.za', 'liezlc@ppetech.co.za');
