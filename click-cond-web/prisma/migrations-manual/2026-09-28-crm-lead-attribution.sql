ALTER TABLE crm_leads
  ADD COLUMN campaign_id VARCHAR(100) NULL AFTER utm_campaign,
  ADD COLUMN ad_group_id VARCHAR(100) NULL AFTER campaign_id,
  ADD COLUMN ad_id VARCHAR(100) NULL AFTER ad_group_id;
