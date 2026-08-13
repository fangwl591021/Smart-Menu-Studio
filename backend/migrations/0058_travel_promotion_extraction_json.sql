ALTER TABLE travel_promotion_versions
ADD COLUMN extraction_json TEXT NOT NULL DEFAULT '{}'
CHECK(json_valid(extraction_json));
