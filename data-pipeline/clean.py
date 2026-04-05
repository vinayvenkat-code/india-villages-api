import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os
import glob

# ── CONFIG ──────────────────────────────────────────────────────────────────
DATABASE_URL = "postgresql://neondb_owner:npg_hHj6lStdkuI1@ep-calm-cake-a1zedvyt-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
DATASET_FOLDER = "dataset"
BATCH_SIZE = 1000
# ────────────────────────────────────────────────────────────────────────────

def get_connection():
    return psycopg2.connect(DATABASE_URL)

def create_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS states (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            code VARCHAR(10) UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS districts (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            code VARCHAR(20),
            state_id INTEGER REFERENCES states(id),
            UNIQUE(code, state_id)
        );
        CREATE TABLE IF NOT EXISTS sub_districts (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            code VARCHAR(20),
            district_id INTEGER REFERENCES districts(id),
            UNIQUE(code, district_id)
        );
        CREATE TABLE IF NOT EXISTS villages (
            id SERIAL PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            sub_district_id INTEGER REFERENCES sub_districts(id),
            UNIQUE(name, sub_district_id)
        );
    """)
    conn.commit()
    cur.close()
    print("✅ Tables ready!")

def get_or_create_state(cur, state_name, state_code):
    cur.execute("""
        INSERT INTO states (name, code) VALUES (%s, %s)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
    """, (state_name.strip().title(), str(state_code).strip()))
    return cur.fetchone()[0]

def get_or_create_district(cur, district_name, district_code, state_id):
    cur.execute("""
        INSERT INTO districts (name, code, state_id) VALUES (%s, %s, %s)
        ON CONFLICT (code, state_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
    """, (district_name.strip().title(), str(district_code).strip(), state_id))
    return cur.fetchone()[0]

def get_or_create_sub_district(cur, sub_name, sub_code, district_id):
    cur.execute("""
        INSERT INTO sub_districts (name, code, district_id) VALUES (%s, %s, %s)
        ON CONFLICT (code, district_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
    """, (sub_name.strip().title(), str(sub_code).strip(), district_id))
    return cur.fetchone()[0]

def read_file(filepath):
    """Read XLS or ODS file and return dataframe"""
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext == '.ods':
            df = pd.read_excel(filepath, header=None, engine='odf')
        else:
            df = pd.read_excel(filepath, header=None, engine='xlrd')
        return df
    except Exception as e:
        print(f"   ⚠️ Could not read file: {e}")
        return None

def process_file(conn, filepath):
    filename = os.path.basename(filepath)
    print(f"\n📂 Processing: {filename}")

    try:
        df = read_file(filepath)
        if df is None:
            return 0

        # Handle different column counts
        num_cols = df.shape[1]
        if num_cols >= 8:
            df = df.iloc[:, :8]
            df.columns = ['state_code', 'state_name', 'district_code',
                          'district_name', 'sub_district_code',
                          'sub_district_name', 'village_code', 'village_name']
        elif num_cols == 6:
            df.columns = ['state_code', 'state_name', 'district_code',
                          'district_name', 'village_code', 'village_name']
            df.insert(4, 'sub_district_code', '00000')
            df.insert(5, 'sub_district_name', df['district_name'])
        else:
            print(f"   ⚠️ Unexpected column count: {num_cols}, skipping")
            return 0

        # Drop header row
        df = df.iloc[1:].reset_index(drop=True)

        # Filter out summary rows and empty rows
        df = df[df['village_code'].astype(str).str.strip() != '000000']
        df = df[df['village_name'].notna()]
        df = df[~df['village_name'].astype(str).str.strip().isin(['', 'nan'])]

        print(f"   Rows to process: {len(df)}")

        cur = conn.cursor()
        village_batch = []
        current_state_id = None
        current_district_id = None
        current_sub_district_id = None
        current_district_code = None
        current_sub_district_code = None
        villages_inserted = 0

        for _, row in df.iterrows():
            state_code    = str(row['state_code']).strip()
            state_name    = str(row['state_name']).strip()
            district_code = str(row['district_code']).strip()
            district_name = str(row['district_name']).strip()
            sub_code      = str(row['sub_district_code']).strip()
            sub_name      = str(row['sub_district_name']).strip()
            village_name  = str(row['village_name']).strip()

            if not village_name or village_name == 'nan':
                continue
            if not state_name or state_name == 'nan':
                continue

            if current_state_id is None:
                current_state_id = get_or_create_state(cur, state_name, state_code)

            if district_code != current_district_code:
                current_district_id = get_or_create_district(
                    cur, district_name, district_code, current_state_id)
                current_district_code = district_code
                current_sub_district_code = None

            if sub_code != current_sub_district_code:
                current_sub_district_id = get_or_create_sub_district(
                    cur, sub_name, sub_code, current_district_id)
                current_sub_district_code = sub_code

            village_batch.append((village_name.title(), current_sub_district_id))

            if len(village_batch) >= BATCH_SIZE:
                execute_values(cur, """
                    INSERT INTO villages (name, sub_district_id)
                    VALUES %s
                    ON CONFLICT (name, sub_district_id) DO NOTHING
                """, village_batch)
                villages_inserted += len(village_batch)
                village_batch = []
                print(f"   Inserted {villages_inserted} villages so far...")

        if village_batch:
            execute_values(cur, """
                INSERT INTO villages (name, sub_district_id)
                VALUES %s
                ON CONFLICT (name, sub_district_id) DO NOTHING
            """, village_batch)
            villages_inserted += len(village_batch)

        conn.commit()
        cur.close()
        print(f"   ✅ Done! {villages_inserted} villages inserted from {filename}")
        return villages_inserted

    except Exception as e:
        conn.rollback()
        print(f"   ❌ Error processing {filename}: {e}")
        return 0

def print_summary(conn):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM states")
    states = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM districts")
    districts = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sub_districts")
    sub_districts = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM villages")
    villages = cur.fetchone()[0]
    cur.close()
    print("\n" + "="*50)
    print("📊 IMPORT SUMMARY")
    print("="*50)
    print(f"   States:        {states:,}")
    print(f"   Districts:     {districts:,}")
    print(f"   Sub-Districts: {sub_districts:,}")
    print(f"   Villages:      {villages:,}")
    print("="*50)

def main():
    print("🚀 Starting All India Villages Import...")
    print(f"   Dataset folder: {DATASET_FOLDER}")

    xls_files = glob.glob(f"{DATASET_FOLDER}/*.xls")
    ods_files = glob.glob(f"{DATASET_FOLDER}/*.ods")
    all_files = sorted(xls_files + ods_files)
    print(f"   Found {len(all_files)} state files")

    print("\n🔌 Connecting to database...")
    conn = get_connection()
    print("   ✅ Connected!")

    create_tables(conn)

    total_villages = 0
    for i, filepath in enumerate(all_files, 1):
        print(f"\n[{i}/{len(all_files)}]", end="")
        villages = process_file(conn, filepath)
        total_villages += villages

    print_summary(conn)
    conn.close()
    print("\n✅ Import complete!")

if __name__ == "__main__":
    main()