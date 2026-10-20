"""SQLite/local schema initialization.

Postgres deployments use Alembic migrations (``alembic upgrade head``).
For the local/demo mode the SQLite database is initialized directly from the
SQLAlchemy model metadata so the console works out of the box without a
migration toolchain. This module is a no-op on Postgres connections.
"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateColumn

from app.db.base import Base
from app.db.types import is_sqlite_url

logger = logging.getLogger(__name__)


def initialize_sqlite_schema() -> None:
    """Create all tables when running against a SQLite database.

    Safe to call repeatedly: ``create_all`` skips tables that already exist,
    and columns added to existing models are appended to older databases.
    Non-SQLite connections are left to Alembic migrations.
    """
    if not is_sqlite_url():
        return
    from app.db.session import engine
    from app import models  # noqa: F401 - register all models with metadata

    Base.metadata.create_all(engine)
    add_missing_sqlite_columns(engine)
    logger.info("sqlite_schema_initialized")


def add_missing_sqlite_columns(engine: Engine) -> list[str]:
    """``ALTER TABLE ... ADD COLUMN`` for model columns an existing SQLite table lacks.

    ``create_all`` never alters existing tables, so a database created by an
    older version would otherwise fail on the new columns.
    """
    added: list[str] = []
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                default = getattr(column.server_default, "arg", None)
                if column.server_default is not None and not isinstance(default, str):
                    # SQLite only accepts constant defaults in ADD COLUMN (no CURRENT_TIMESTAMP).
                    column = column._copy()
                    column.server_default = None
                ddl = str(CreateColumn(column).compile(dialect=engine.dialect))
                if column.server_default is None:
                    # SQLite cannot add a NOT NULL column without a default; the ORM always sets a value.
                    ddl = ddl.replace(" NOT NULL", "")
                connection.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {ddl}"))
                added.append(f"{table.name}.{column.name}")
    if added:
        logger.info("sqlite_columns_added", extra={"event": "sqlite_columns_added"})
    return added
