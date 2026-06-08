-- Seed vendor_sites from Vendor Registry CSV
-- Each row maps a package to its SharePoint drop-off and return libraries.
-- source_list_id  = the FROM VENDOR SharePoint list GUID (for intake watcher)
-- target_list_id  = the TO VENDOR SharePoint list GUID (for return flow)
-- return_library  = folder path the Logic App copies files into (e.g. '/TO VENDOR')

-- Add unique constraint so ON CONFLICT works (one site config per package)
ALTER TABLE vendor_sites
  ADD CONSTRAINT vendor_sites_package_id_unique UNIQUE (package_id);

-- ON CONFLICT: if a vendor_sites row for that package already exists, update it.

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/E101-36MVAHighSpeedDieselGeneratorPlant2',
       'FROM VENDOR', '/TO VENDOR',
       '0b616c62-0b2c-4587-9e6f-600b9fc330d1', 'd953c208-481d-401c-8ed1-75f3a16a2b95',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'E101'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/E102-SynchronousCondensers',
       'FROM VENDOR', '/TO VENDOR',
       '5c2634e7-2aa0-4046-a989-95475b966a77', 'c3a4f2c3-95b2-4245-9752-745a07778dc9',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'E102'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/E103-PowerFactorCorrectionFilterBanks',
       'FROM VENDOR', '/TO VENDOR',
       'dfd4aac3-369e-46ce-8dc6-8ff6a6856346', 'f42febc4-ca77-4935-aa5a-d10b80dd82e1',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'E103'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/E121-ConcentratorPlant133kVConsumerSubstation',
       'FROM VENDOR', '/TO VENDOR',
       '7f096a1c-e9d9-47ab-8d35-3639e86d9571', '945c76c6-565e-4460-896f-c92eab4f59a4',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'E121'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/E122-MiningSubstation33kV11kV',
       'FROM VENDOR', '/TO VENDOR',
       '89d8cfd1-6d41-4632-a1d8-aebd6d007360', '669d0380-9e43-4f30-a183-7abb2ba5492a',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'E122'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/E123-11kV20MWResistiveLoadBank',
       'FROM VENDOR', '/TO VENDOR',
       '7965a80d-3e70-4ab2-b689-ff35306bc7cb', '9c5db80e-218d-415d-83f7-98c19c5c0d44',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'E123'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/K108-BatteryEnergyStorageSystem',
       'FROM VENDOR', '/TO VENDOR',
       'a0ade23b-0451-47ac-8747-24ebbf2d1686', 'd59f1276-012b-46ae-a80b-32b8af36ac4a',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'K108'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/K110-SolarPhotovoltaicPowerPlant',
       'Drop - Off', '/TO VENDOR',
       'ea530ff1-289b-421d-99aa-30d60be57220', '15ca8089-09fe-4ed0-aea5-2999bda4fc76',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'K110'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/K125-220kVTransmissionSubstations',
       'FROM VENDOR', '/TO VENDOR',
       '4e624b88-483e-4409-90e1-40975a9b5638', 'ac5ad8bc-f5ce-4c41-8434-f87eb980760f',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'K125'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/K137-220kVand33kVOverheadLines',
       'FROM PSI', '/TO VENDOR',
       'd0387af7-9267-464c-9be5-00277fcf11a8', '6464468f-653f-40b7-8fa5-ddabe43414ab',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'K137'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;

-- ICTS: return library is '/TO ICTS' (matches the Logic App's URL-pattern check for '/icts')
INSERT INTO vendor_sites (package_id, site_url, dropoff_library, return_library, source_list_id, target_list_id, controller_email, active)
SELECT p.id,
       'https://ppetechcoza.sharepoint.com/sites/ICTS',
       'FROM ICTS', '/TO ICTS',
       '7184bf75-6d80-46b9-864b-deadaff405cb', 'e9ecb02c-6a94-4612-8ccc-dd0b9ab62422',
       'mornec@ppetech.co.za', true
FROM packages p WHERE p.package_code = 'ICTS'
ON CONFLICT (package_id) DO UPDATE
  SET site_url = EXCLUDED.site_url, dropoff_library = EXCLUDED.dropoff_library,
      return_library = EXCLUDED.return_library, source_list_id = EXCLUDED.source_list_id,
      target_list_id = EXCLUDED.target_list_id, controller_email = EXCLUDED.controller_email;
