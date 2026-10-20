from sqlalchemy import create_engine, inspect, text

from app.services.schema import add_missing_sqlite_columns


def test_existing_query_logs_table_gains_new_columns(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE query_logs (id INTEGER PRIMARY KEY, trace_id VARCHAR(64), query TEXT, latency_ms INTEGER, model VARCHAR(128), status VARCHAR(32))"))
        connection.execute(text("INSERT INTO query_logs (trace_id, query, latency_ms, model, status) VALUES ('t', 'q', 1, 'm', 'completed')"))

    added = add_missing_sqlite_columns(engine)

    assert {"query_logs.source", "query_logs.evaluation_status", "query_logs.evaluation_json", "query_logs.failure_category"} <= set(added)
    columns = {column["name"] for column in inspect(engine).get_columns("query_logs")}
    assert {"source", "diagnosis_json"} <= columns
    with engine.connect() as connection:
        assert connection.execute(text("SELECT source, evaluation_status, evaluation_json FROM query_logs")).one() == ("api", "skipped", "{}")
    assert add_missing_sqlite_columns(engine) == []
