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
            context.configure(
                connection=connection,
                target_metadata=None,
                compare_type=True,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
