
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_MB = Math.max(1, Number(process.env.MAX_FILE_MB || 5));

const uploadDir = path.join(__dirname, 'private_uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'jeallz',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'portal_atividades',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  ssl: {
    minVersion: 'TLSv1.2'
  }
};

const pool = mysql.createPool(dbConfig);
const MySQLStore = MySQLStoreFactory(session);

// A conexão que armazena as sessões também precisa de TLS.
const sessionStore = new MySQLStore({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  ssl: dbConfig.ssl,
  connectTimeout: 10000,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 900000
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// O Render atua como proxy HTTPS na frente do Express.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  name: 'portal.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.maxFileMb = MAX_FILE_MB;
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});

const allowedExtensions = new Set([
  '.pdf', '.doc', '.docx', '.odt', '.txt',
  '.js', '.html', '.css', '.py', '.json',
  '.sb3', '.zip', '.rar',
  '.png', '.jpg', '.jpeg', '.webp',
  '.ppt', '.pptx', '.xls', '.xlsx', '.csv'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(
      null,
      `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`
    );
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.has(ext)) {
      return cb(new Error('Tipo de arquivo não permitido.'));
    }

    cb(null, true);
  }
});

function setNotice(req, type, message) {
  req.session.notice = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  next();
}

function requireRoot(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role !== 'root') {
    return res.status(403).render('error', {
      title: 'Acesso restrito',
      message: 'Esta área é exclusiva do professor.'
    });
  }

  next();
}

function requireStudent(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role !== 'student') {
    return res.redirect('/admin');
  }

  next();
}

function asyncRoute(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

function safeOriginalName(name) {
  return path.basename(name)
    .replace(/[\r\n\0]/g, '')
    .slice(0, 255);
}

async function ensureRoot() {
  const username = (process.env.ROOT_USERNAME || 'professor').trim();
  const password = process.env.ROOT_PASSWORD;

  if (!password) {
    console.warn('Configure ROOT_PASSWORD no ambiente.');
    return;
  }

  const [rows] = await pool.execute(
    'SELECT id FROM users WHERE username = ? AND role = ? LIMIT 1',
    [username, 'root']
  );

  if (!rows.length) {
    const hash = await bcrypt.hash(password, 12);

    await pool.execute(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, 'root']
    );

    console.log(`Conta do professor criada: ${username}`);
  }
}

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  res.redirect(
    req.session.user.role === 'root' ? '/admin' : '/aluno'
  );
});

app.get('/login', (req, res) => {
  res.render('login', {
    mode: 'login',
    title: 'Entrar'
  });
});

app.get('/cadastro', (req, res) => {
  res.render('login', {
    mode: 'register',
    title: 'Criar conta'
  });
});

// CADASTRO DO ALUNO
app.post('/cadastro', asyncRoute(async (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const code = String(req.body.access_code || '').trim();

  const morningCode = String(
    process.env.REGISTRATION_CODE_MANHA || ''
  ).trim();

  const afternoonCode = String(
    process.env.REGISTRATION_CODE_TARDE || ''
  ).trim();

  let className = '';

  if (morningCode && code === morningCode) {
    className = 'manha';
  } else if (afternoonCode && code === afternoonCode) {
    className = 'tarde';
  }

  if (!className) {
    setNotice(req, 'error', 'Código de acesso inválido.');
    return res.redirect('/cadastro');
  }

  if (fullName.length < 3 || fullName.length > 120) {
    setNotice(req, 'error', 'Informe seu nome completo.');
    return res.redirect('/cadastro');
  }

  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    setNotice(req, 'error', 'Nome de usuário inválido.');
    return res.redirect('/cadastro');
  }

  if (password.length < 8 || password.length > 72) {
    setNotice(req, 'error', 'A senha deve ter entre 8 e 72 caracteres.');
    return res.redirect('/cadastro');
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    await pool.execute(
      `INSERT INTO users
       (full_name, username, password_hash, role, class_name)
       VALUES (?, ?, ?, 'student', ?)`,
      [fullName, username, hash, className]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      setNotice(req, 'error', 'Este usuário já está cadastrado.');
      return res.redirect('/cadastro');
    }

    throw err;
  }

  setNotice(req, 'success', 'Cadastro realizado!');
  res.redirect('/login');
}));

// LOGIN
app.post('/login', asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const [rows] = await pool.execute(
    `SELECT id, full_name, username, password_hash, role, class_name
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [username]
  );

  const found = rows[0];

  if (!found || !(await bcrypt.compare(password, found.password_hash))) {
    setNotice(req, 'error', 'Usuário ou senha incorretos.');
    return res.redirect('/login');
  }

  req.session.regenerate((err) => {
    if (err) {
      console.error('Erro ao regenerar sessão:', err);
      return res.status(500).send('Erro ao iniciar sessão.');
    }

    req.session.user = {
      id: found.id,
      full_name: found.full_name,
      username: found.username,
      role: found.role,
      class_name: found.class_name
    };

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Erro ao salvar sessão:', saveErr);
        return res.status(500).send('Erro ao salvar sessão.');
      }

      const destination =
        found.role === 'root' ? '/admin' : '/aluno';

      res.redirect(destination);
    });
  });
}));

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ÁREA DO ALUNO
app.get('/aluno', requireStudent, asyncRoute(async (req, res) => {
  const studentId = req.session.user.id;
  const className = req.session.user.class_name;

  const [activities] = await pool.execute(
    `SELECT a.*, s.id AS submission_id, s.original_name,
            s.submitted_at, s.grade, s.feedback, s.graded_at
     FROM activities a
     LEFT JOIN submissions s
       ON s.activity_id = a.id AND s.student_id = ?
     WHERE a.class_name = ?
     ORDER BY (a.due_date IS NULL), a.due_date ASC, a.created_at DESC`,
    [studentId, className]
  );

  const [totals] = await pool.execute(
    `SELECT COALESCE(SUM(s.grade), 0) AS total,
            COUNT(s.grade) AS graded_count
     FROM submissions s
     JOIN activities a ON a.id = s.activity_id
     WHERE s.student_id = ?
       AND a.class_name = ?
       AND s.grade IS NOT NULL`,
    [studentId, className]
  );

  const [rankRows] = await pool.execute(
    `SELECT ranked.position
     FROM (
       SELECT u.id,
              RANK() OVER (
                ORDER BY COALESCE(SUM(s.grade), 0) DESC
              ) AS position
       FROM users u
       LEFT JOIN submissions s
         ON s.student_id = u.id AND s.grade IS NOT NULL
       LEFT JOIN activities a
         ON a.id = s.activity_id AND a.class_name = u.class_name
       WHERE u.role = 'student' AND u.class_name = ?
       GROUP BY u.id
     ) ranked
     WHERE ranked.id = ?`,
    [className, studentId]
  );

  res.render('student', {
    title: 'Pelotão Esperança',
    activities,
    total: Number(totals[0].total),
    gradedCount: Number(totals[0].graded_count),
    rank: rankRows[0]?.position || '—'
  });
}));

// ENVIO DE ARQUIVO PELO ALUNO
app.post(
  '/aluno/atividade/:id/enviar',
  requireStudent,
  (req, res, next) => {
    upload.single('arquivo')(req, res, err => {
      if (err) {
        setNotice(
          req,
          'error',
          err.code === 'LIMIT_FILE_SIZE'
            ? `O arquivo ultrapassa ${MAX_FILE_MB} MB.`
            : err.message || 'Não foi possível receber o arquivo.'
        );

        return res.redirect('/aluno');
      }

      next();
    });
  },
  asyncRoute(async (req, res) => {
    if (!req.file) {
      setNotice(req, 'error', 'Selecione um arquivo.');
      return res.redirect('/aluno');
    }

    const activityId = Number(req.params.id);

    const [activities] = await pool.execute(
      'SELECT id, due_date, class_name FROM activities WHERE id = ?',
      [activityId]
    );

    if (
      !activities.length ||
      activities[0].class_name !== req.session.user.class_name
    ) {
      fs.unlink(req.file.path, () => {});
      setNotice(req, 'error', 'Atividade não encontrada para sua turma.');
      return res.redirect('/aluno');
    }

    const activity = activities[0];

    if (
      activity.due_date &&
      new Date(activity.due_date).getTime() < Date.now()
    ) {
      fs.unlink(req.file.path, () => {});
      setNotice(req, 'error', 'O prazo desta atividade encerrou.');
      return res.redirect('/aluno');
    }

    try {
      const [existing] = await pool.execute(
        `SELECT id, stored_name FROM submissions
         WHERE activity_id = ? AND student_id = ?`,
        [activityId, req.session.user.id]
      );

      if (existing.length) {
        await pool.execute(
          `UPDATE submissions
           SET stored_name = ?, original_name = ?, mime_type = ?,
               file_size = ?, grade = NULL, feedback = NULL,
               graded_at = NULL, submitted_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            req.file.filename,
            safeOriginalName(req.file.originalname),
            req.file.mimetype,
            req.file.size,
            existing[0].id
          ]
        );

        fs.unlink(
          path.join(uploadDir, existing[0].stored_name),
          () => {}
        );
      } else {
        await pool.execute(
          `INSERT INTO submissions
           (activity_id, student_id, stored_name, original_name, mime_type, file_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            activityId,
            req.session.user.id,
            req.file.filename,
            safeOriginalName(req.file.originalname),
            req.file.mimetype,
            req.file.size
          ]
        );
      }
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      throw err;
    }

    setNotice(req, 'success', 'Arquivo enviado com sucesso!');
    res.redirect('/aluno');
  })
);

// PAINEL DO PROFESSOR
app.get('/admin', requireRoot, asyncRoute(async (req, res) => {
  const [activities] = await pool.execute(
    `SELECT a.*, COUNT(s.id) AS submission_count,
            COUNT(s.grade) AS graded_count
     FROM activities a
     LEFT JOIN submissions s ON s.activity_id = a.id
     GROUP BY a.id
     ORDER BY a.created_at DESC`
  );

  const [studentsManha] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.created_at,
            u.class_name,
            COALESCE(SUM(s.grade), 0) AS total_score,
            COUNT(s.grade) AS graded_count
     FROM users u
     LEFT JOIN submissions s
       ON s.student_id = u.id AND s.grade IS NOT NULL
     LEFT JOIN activities a
       ON a.id = s.activity_id AND a.class_name = u.class_name
     WHERE u.role = 'student' AND u.class_name = 'manha'
     GROUP BY u.id
     ORDER BY total_score DESC, u.full_name ASC`
  );

  const [studentsTarde] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.created_at,
            u.class_name,
            COALESCE(SUM(s.grade), 0) AS total_score,
            COUNT(s.grade) AS graded_count
     FROM users u
     LEFT JOIN submissions s
       ON s.student_id = u.id AND s.grade IS NOT NULL
     LEFT JOIN activities a
       ON a.id = s.activity_id AND a.class_name = u.class_name
     WHERE u.role = 'student' AND u.class_name = 'tarde'
     GROUP BY u.id
     ORDER BY total_score DESC, u.full_name ASC`
  );

  const [counts] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
      (SELECT COUNT(*) FROM activities) AS activities,
      (SELECT COUNT(*) FROM submissions) AS submissions,
      (SELECT COUNT(*) FROM submissions WHERE grade IS NOT NULL) AS graded`
  );

  res.render('admin', {
    title: 'Pelotão Esperança',
    activities,
    studentsManha,
    studentsTarde,
    counts: counts[0]
  });
}));

// CRIAR ATIVIDADE PARA UMA TURMA
app.post('/admin/atividades', requireRoot, asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const rawDate = String(req.body.due_date || '').trim();
  const className = String(req.body.class_name || '');

  if (!['manha', 'tarde'].includes(className)) {
    setNotice(req, 'error', 'Selecione a turma.');
    return res.redirect('/admin');
  }

  if (
    title.length < 3 ||
    title.length > 140 ||
    description.length < 3 ||
    description.length > 10000
  ) {
    setNotice(req, 'error', 'Informe um título e uma descrição válidos.');
    return res.redirect('/admin');
  }

  let dueDate = null;

  if (rawDate) {
    const parsed = new Date(rawDate);

    if (Number.isNaN(parsed.getTime())) {
      setNotice(req, 'error', 'Prazo inválido.');
      return res.redirect('/admin');
    }

    dueDate = parsed;
  }

  await pool.execute(
    `INSERT INTO activities (title, description, due_date, class_name)
     VALUES (?, ?, ?, ?)`,
    [title, description, dueDate, className]
  );

  setNotice(req, 'success', 'Atividade publicada!');
  res.redirect('/admin');
}));

// EXCLUIR ATIVIDADE
app.post(
  '/admin/atividades/:id/excluir',
  requireRoot,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    const [files] = await pool.execute(
      'SELECT stored_name FROM submissions WHERE activity_id = ?',
      [id]
    );

    await pool.execute('DELETE FROM activities WHERE id = ?', [id]);

    for (const file of files) {
      fs.unlink(path.join(uploadDir, file.stored_name), () => {});
    }

    setNotice(req, 'success', 'Atividade excluída.');
    res.redirect('/admin');
  })
);

// VER ENTREGAS
app.get(
  '/admin/atividades/:id',
  requireRoot,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    const [activities] = await pool.execute(
      'SELECT * FROM activities WHERE id = ?',
      [id]
    );

    if (!activities.length) {
      return res.status(404).render('error', {
        title: 'Atividade não encontrada',
        message: 'Esta atividade não existe.'
      });
    }

    const [submissions] = await pool.execute(
      `SELECT s.*, u.full_name, u.username, u.class_name
       FROM submissions s
       JOIN users u ON u.id = s.student_id
       WHERE s.activity_id = ?
       ORDER BY u.full_name ASC, s.submitted_at DESC`,
      [id]
    );

    res.render('submissions', {
      title: 'Entregas',
      activity: activities[0],
      submissions
    });
  })
);

// LANÇAR NOTA
app.post(
  '/admin/envios/:id/nota',
  requireRoot,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const grade = String(req.body.grade ?? '').trim();
    const feedback = String(req.body.feedback || '').trim().slice(0, 1000);

    if (grade === '') {
      await pool.execute(
        `UPDATE submissions
         SET grade = NULL, feedback = ?, graded_at = NULL
         WHERE id = ?`,
        [feedback || null, id]
      );
    } else {
      const n = Number(grade);

      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setNotice(req, 'error', 'A nota deve ser de 0 a 100.');
        return res.redirect('back');
      }

      await pool.execute(
        `UPDATE submissions
         SET grade = ?, feedback = ?, graded_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [n, feedback || null, id]
      );
    }

    const [rows] = await pool.execute(
      'SELECT activity_id FROM submissions WHERE id = ?',
      [id]
    );

    setNotice(req, 'success', 'Nota salva!');

    res.redirect(
      rows.length ? `/admin/atividades/${rows[0].activity_id}` : '/admin'
    );
  })
);

// BAIXAR ARQUIVO ENTREGUE
app.get(
  '/admin/envios/:id/arquivo',
  requireRoot,
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT stored_name, original_name FROM submissions WHERE id = ?',
      [Number(req.params.id)]
    );

    if (!rows.length) {
      return res.status(404).render('error', {
        title: 'Arquivo não encontrado',
        message: 'Este envio não está disponível.'
      });
    }

    const filePath = path.join(uploadDir, rows[0].stored_name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).render('error', {
        title: 'Arquivo ausente',
        message: 'O arquivo não foi encontrado no servidor.'
      });
    }

    res.download(filePath, rows[0].original_name);
  })
);

// RANKING SEPARADO POR TURMA
app.get('/ranking', requireAuth, asyncRoute(async (req, res) => {
  const turma = req.session.user.role === 'root'
    ? (['manha', 'tarde'].includes(req.query.turma)
      ? req.query.turma
      : 'manha')
    : req.session.user.class_name;

  const [students] = await pool.execute(
    `SELECT u.full_name, u.username, u.class_name,
            COALESCE(SUM(s.grade), 0) AS total_score,
            COUNT(s.grade) AS graded_count
     FROM users u
     LEFT JOIN submissions s
       ON s.student_id = u.id AND s.grade IS NOT NULL
     LEFT JOIN activities a
       ON a.id = s.activity_id AND a.class_name = u.class_name
     WHERE u.role = 'student' AND u.class_name = ?
     GROUP BY u.id
     ORDER BY total_score DESC, u.full_name ASC`,
    [turma]
  );

  res.render('ranking', {
    title: 'Ranking | Pelotão Esperança',
    students,
    turma
  });
}));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Página não encontrada',
    message: 'Não encontramos essa página.'
  });
});

app.use((err, req, res, _next) => {
  console.error(err);

  if (req.session) {
    setNotice(req, 'error', 'Ocorreu um erro inesperado.');
  }

  res.status(500).render('error', {
    title: 'Erro',
    message: process.env.NODE_ENV === 'production'
      ? 'Não foi possível concluir a ação. Tente novamente.'
      : (err.message || 'Erro interno.')
  });
});

// Abre a porta imediatamente para o Render detectar o serviço.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pelotão Esperança iniciado na porta ${PORT}.`);
});

// Diagnostica a conexão sem bloquear a abertura da porta.
(async function inicializarBanco() {
  try {
    await pool.query('SELECT 1');
    console.log('Conexão com o MySQL estabelecida.');

    await ensureRoot();
    console.log('Inicialização do banco concluída.');
  } catch (err) {
    console.error('Falha na inicialização do banco:', err);
  }
})();

// A conexão do armazenamento de sessões é independente do pool principal.
sessionStore.onReady()
  .then(() => console.log('Armazenamento de sessões pronto.'))
  .catch(err => console.error('Falha no armazenamento de sessões:', err));
