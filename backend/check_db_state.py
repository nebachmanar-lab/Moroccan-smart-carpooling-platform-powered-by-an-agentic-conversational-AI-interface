import os
from dotenv import load_dotenv
import psycopg2

load_dotenv()
conn = psycopg2.connect(os.environ['DATABASE_URL_SYNC'].replace('postgresql+psycopg2://', 'postgresql://'))
cur = conn.cursor()
cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
print('tables:', [r[0] for r in cur.fetchall()])
cur.execute("SELECT typname FROM pg_type WHERE typname IN ('ridestatus','bookingstatus') ORDER BY typname")
print('types:', [r[0] for r in cur.fetchall()])
cur.execute('SELECT version_num FROM alembic_version')
print('alembic_version:', cur.fetchone()[0])
for tbl in ['rides', 'bookings', 'driver_preferences']:
    cur.execute(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = %s ORDER BY ordinal_position",
        (tbl,),
    )
    print(f"{tbl} columns:", [(r[0], r[1]) for r in cur.fetchall()])
    cur.execute("SELECT indexname FROM pg_indexes WHERE tablename = %s ORDER BY indexname", (tbl,))
    print(f"{tbl} indexes:", [r[0] for r in cur.fetchall()])
conn.close()
