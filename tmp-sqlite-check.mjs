import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('test.sqlite');
db.exec('create table if not exists t(id integer primary key, name text)');
db.exec("insert into t(name) values('ok')");
console.log(db.prepare('select count(*) as c from t').get().c);
db.close();
