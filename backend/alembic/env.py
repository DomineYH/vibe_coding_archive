from alembic import context
from app.database import make_migration_engine
from app.settings import Settings

settings = Settings.from_environment()


def run_migrations_offline() -> None:
    context.configure(
        url=f"sqlite:///{settings.database_path}",
        target_metadata=None,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_migration_engine(settings.database_path)
    try:
        with engine.connect() as connection:
            # SQLite must disable FK enforcement before a parent-table batch copy.
            # The entire migration is transactional; integrity is checked before commit.
            connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
            connection.commit()
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            context.configure(
                connection=connection,
                target_metadata=None,
                compare_type=True,
            )
            with context.begin_transaction():
                context.run_migrations()
            if connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Migration foreign key integrity check failed.")
            connection.commit()
            connection.exec_driver_sql("PRAGMA foreign_keys = ON")
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
