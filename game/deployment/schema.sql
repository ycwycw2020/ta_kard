CREATE TABLE IF NOT EXISTS profiles(address text PRIMARY KEY,equipped jsonb NOT NULL DEFAULT '{}',items jsonb NOT NULL DEFAULT '{"resource_cell":2,"medkit":2,"full_restore":2,"barrier_generator":2,"cleanser":2,"reactivation":2}',faucet_used boolean NOT NULL DEFAULT false);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS loadout jsonb NOT NULL DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipped_tokens jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS nonces(id text PRIMARY KEY,address text NOT NULL,message text NOT NULL,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,address text NOT NULL REFERENCES profiles(address),expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS matches(id uuid PRIMARY KEY,mode text NOT NULL,a text NOT NULL,b text,team_a jsonb NOT NULL,team_b jsonb,item_a text NOT NULL,item_b text,state jsonb,seq integer NOT NULL DEFAULT 0,seed text NOT NULL,commitment text NOT NULL,roster_hash text,created timestamptz NOT NULL DEFAULT now(),updated timestamptz NOT NULL DEFAULT now(),finished bigint,replay jsonb NOT NULL DEFAULT '[]',acks jsonb NOT NULL DEFAULT '[]',cancelled boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS active_players(address text PRIMARY KEY REFERENCES profiles(address),match_id uuid NOT NULL REFERENCES matches(id));
CREATE TABLE IF NOT EXISTS actions(match_id uuid NOT NULL REFERENCES matches(id),action_id uuid NOT NULL,address text NOT NULL,seq integer NOT NULL,PRIMARY KEY(match_id,action_id));
CREATE TABLE IF NOT EXISTS chain_events(tx_hash text NOT NULL,log_index integer NOT NULL,block_number integer NOT NULL,block_hash text NOT NULL,event_name text NOT NULL,args jsonb NOT NULL,PRIMARY KEY(tx_hash,log_index));
CREATE TABLE IF NOT EXISTS card_balances(address text NOT NULL,token_id integer NOT NULL,balance bigint NOT NULL,PRIMARY KEY(address,token_id));
CREATE TABLE IF NOT EXISTS indexer_state(id integer PRIMARY KEY CHECK(id=1),block_number integer NOT NULL,block_hash text,updated timestamptz NOT NULL DEFAULT now());

ALTER TABLE matches ADD COLUMN IF NOT EXISTS ai_due bigint;
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS contract_address text;
CREATE INDEX IF NOT EXISTS chain_events_contract_block ON chain_events(contract_address,block_number DESC);
CREATE TABLE IF NOT EXISTS card_instances(token_id numeric(78,0) PRIMARY KEY,artwork_id integer,owner text NOT NULL,updated_block bigint NOT NULL,transaction_hash text NOT NULL);
